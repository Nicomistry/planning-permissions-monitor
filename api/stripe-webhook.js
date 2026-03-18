// POST /api/stripe-webhook
// Handles Stripe subscription lifecycle events.
// Signature verified via STRIPE_WEBHOOK_SECRET before any processing.
//
// TEST MODE — swap STRIPE_SECRET_KEY to sk_live_ for production.

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(typeof c === 'string' ? Buffer.from(c) : c));
    req.on('end',   () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const STRIPE_SECRET_KEY    = process.env.STRIPE_SECRET_KEY;
  const WEBHOOK_SECRET       = process.env.STRIPE_WEBHOOK_SECRET;
  const SUPABASE_URL         = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!STRIPE_SECRET_KEY || !WEBHOOK_SECRET) {
    return res.status(500).json({ error: 'Stripe not configured' });
  }

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

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // ── Helper: resolve plan_id from plan name ──────────────────────────────────
  async function getPlanId(planName) {
    const { data } = await sb.from('plans').select('id').ilike('name', planName).single();
    return data?.id ?? null;
  }

  // ── Helper: update profile ──────────────────────────────────────────────────
  async function updateProfile(userId, patch) {
    const { error } = await sb.from('profiles').update(patch).eq('user_id', userId);
    if (error) console.error('updateProfile error:', error.message);
  }

  // ── Helper: upsert user_plans ───────────────────────────────────────────────
  async function upsertUserPlan(userId, patch) {
    const { error } = await sb
      .from('user_plans')
      .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' });
    if (error) console.error('upsertUserPlan error:', error.message);
  }

  // ── Event handlers ──────────────────────────────────────────────────────────

  if (event.type === 'checkout.session.completed') {
    const session  = event.data.object;
    const userId   = session.metadata?.user_id || session.client_reference_id;
    const planKey  = session.metadata?.plan_key ?? 'starter';

    // ── One-off scan credit ───────────────────────────────────────────────
    if (planKey === 'scan') {
      await updateProfile(userId, { cp_runs_remaining: 1 });
      console.log(`Single scan purchased: userId=${userId}`);
      return res.status(200).json({ received: true });
    }

    const planNameMap = { starter: 'Starter', pro: 'Pro', unlimited: 'Unlimited' };
    const planName = planNameMap[planKey] ?? 'Starter';
    const planId   = await getPlanId(planName);

    if (!userId) {
      console.error('checkout.session.completed: no user_id in metadata');
      return res.status(200).end();
    }

    // Retrieve subscription for stripe_subscription_id
    const subscriptionId = session.subscription;

    await upsertUserPlan(userId, {
      plan_id:                planId,
      status:                 'active',
      stripe_subscription_id: subscriptionId,
    });

    await updateProfile(userId, {
      stripe_customer_id: session.customer,
      cp_runs_remaining:  999, // subscription users get unlimited credits
    });

    console.log(`Subscription activated: userId=${userId} plan=${planName}`);
  }

  else if (event.type === 'invoice.paid') {
    const invoice = event.data.object;
    const subId   = invoice.subscription;
    if (!subId) return res.status(200).end();

    // Find user by subscription ID and keep active
    const { data } = await sb
      .from('user_plans')
      .select('user_id')
      .eq('stripe_subscription_id', subId)
      .single();

    if (data?.user_id) {
      await upsertUserPlan(data.user_id, { status: 'active' });
      console.log(`Invoice paid — kept active: userId=${data.user_id}`);
    }
  }

  else if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object;
    const subId   = invoice.subscription;
    if (!subId) return res.status(200).end();

    const { data } = await sb
      .from('user_plans')
      .select('user_id')
      .eq('stripe_subscription_id', subId)
      .single();

    if (data?.user_id) {
      await upsertUserPlan(data.user_id, { status: 'past_due' });
      console.log(`Payment failed — past_due: userId=${data.user_id}`);
    }
  }

  else if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const subId        = subscription.id;

    const { data } = await sb
      .from('user_plans')
      .select('user_id')
      .eq('stripe_subscription_id', subId)
      .single();

    if (data?.user_id) {
      // Revoke access — both tables in same handler
      await upsertUserPlan(data.user_id, { status: 'cancelled' });
      await updateProfile(data.user_id, { cp_runs_remaining: 0 });
      console.log(`Subscription cancelled — access revoked: userId=${data.user_id}`);
    }
  }

  return res.status(200).json({ received: true });
}
