// POST /api/stripe-webhook
// Handles Stripe subscription lifecycle events.
// Uses raw fetch for Supabase calls (no SDK) to keep bundle minimal.

import Stripe from 'stripe';

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(typeof c === 'string' ? Buffer.from(c) : c));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const WEBHOOK_SECRET    = process.env.STRIPE_WEBHOOK_SECRET;
  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_KEY;

  if (!STRIPE_SECRET_KEY || !WEBHOOK_SECRET) return res.status(500).json({ error: 'Stripe not configured' });

  const stripe  = new Stripe(STRIPE_SECRET_KEY);
  const rawBody = await getRawBody(req);
  const sig     = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature invalid:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  const sbHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_KEY}`, 'apikey': SUPABASE_KEY };

  async function getPlanId(planName) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/plans?name=ilike.${encodeURIComponent(planName)}&select=id&limit=1`, { headers: sbHeaders });
    const rows = r.ok ? await r.json() : [];
    return rows?.[0]?.id ?? null;
  }

  async function updateProfile(userId, patch) {
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}`, {
      method: 'PATCH', headers: { ...sbHeaders, Prefer: 'return=minimal' }, body: JSON.stringify(patch),
    });
  }

  async function upsertUserPlan(userId, patch) {
    await fetch(`${SUPABASE_URL}/rest/v1/user_plans`, {
      method: 'POST', headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: userId, ...patch }),
    });
  }

  async function findUserBySubId(subId) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/user_plans?stripe_subscription_id=eq.${encodeURIComponent(subId)}&select=user_id&limit=1`, { headers: sbHeaders });
    const rows = r.ok ? await r.json() : [];
    return rows?.[0]?.user_id ?? null;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId  = session.metadata?.user_id || session.client_reference_id;
    const planKey = session.metadata?.plan_key ?? 'starter';

    if (planKey === 'scan') {
      await updateProfile(userId, { cp_runs_remaining: 1 });
      return res.status(200).json({ received: true });
    }

    if (!userId) return res.status(200).end();
    const planNameMap = { starter: 'Starter', pro: 'Pro', unlimited: 'Unlimited' };
    const planId = await getPlanId(planNameMap[planKey] ?? 'Starter');

    await upsertUserPlan(userId, { plan_id: planId, status: 'active', stripe_subscription_id: session.subscription });
    await updateProfile(userId, { stripe_customer_id: session.customer, cp_runs_remaining: 999 });
  }

  else if (event.type === 'invoice.paid') {
    const subId = event.data.object.subscription;
    if (!subId) return res.status(200).end();
    const userId = await findUserBySubId(subId);
    if (userId) await upsertUserPlan(userId, { status: 'active' });
  }

  else if (event.type === 'invoice.payment_failed') {
    const subId = event.data.object.subscription;
    if (!subId) return res.status(200).end();
    const userId = await findUserBySubId(subId);
    if (userId) await upsertUserPlan(userId, { status: 'past_due' });
  }

  else if (event.type === 'customer.subscription.deleted') {
    const subId  = event.data.object.id;
    const userId = await findUserBySubId(subId);
    if (userId) {
      await upsertUserPlan(userId, { status: 'cancelled' });
      await updateProfile(userId, { cp_runs_remaining: 0 });
    }
  }

  return res.status(200).json({ received: true });
}
