// POST /api/stripe-manage
// action: 'checkout' — create Stripe Checkout session (body: { action, planKey })
// action: 'portal'   — create Stripe Customer Portal session (body: { action })
// Uses raw fetch for Supabase calls (no SDK) to keep bundle minimal.

import Stripe from 'stripe';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const STRIPE_SECRET_KEY  = process.env.STRIPE_SECRET_KEY;
  const STARTER_PRICE_ID   = process.env.STRIPE_STARTER_PRICE_ID;
  const PRO_PRICE_ID       = process.env.STRIPE_PRO_PRICE_ID;
  const UNLIMITED_PRICE_ID = process.env.STRIPE_UNLIMITED_PRICE_ID;
  const SCAN_PRICE_ID      = process.env.STRIPE_SCAN_PRICE_ID;
  const SUPABASE_URL       = process.env.SUPABASE_URL;
  const SUPABASE_KEY       = process.env.SUPABASE_SERVICE_KEY;

  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe not configured' });

  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  // Verify JWT via Supabase auth endpoint
  const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY },
  });
  if (!userResp.ok) return res.status(401).json({ error: 'Invalid session' });
  const user = await userResp.json();

  const { action, planKey } = req.body || {};
  const stripe = new Stripe(STRIPE_SECRET_KEY);
  const origin = req.headers.origin || 'https://pm-sand.vercel.app';

  // ── Checkout ──────────────────────────────────────────────────────────────
  if (!action || action === 'checkout') {
    if (!['starter', 'pro', 'unlimited', 'scan'].includes(planKey)) {
      return res.status(400).json({ error: 'planKey must be starter, pro, unlimited, or scan' });
    }
    const priceMap = { starter: STARTER_PRICE_ID, pro: PRO_PRICE_ID, unlimited: UNLIMITED_PRICE_ID, scan: SCAN_PRICE_ID };
    const priceId = priceMap[planKey];
    if (!priceId) return res.status(500).json({ error: `Price not configured for plan: ${planKey}` });

    const isScan = planKey === 'scan';
    const session = await stripe.checkout.sessions.create({
      mode:                 isScan ? 'payment' : 'subscription',
      payment_method_types: ['card'],
      line_items:           [{ price: priceId, quantity: 1 }],
      client_reference_id:  user.id,
      customer_email:       user.email,
      success_url:          `${origin}/dashboard.html?welcome=1`,
      cancel_url:           `${origin}/pricing.html?cancelled=1`,
      metadata:             { user_id: user.id, plan_key: planKey },
    });
    return res.status(200).json({ url: session.url });
  }

  // ── Billing portal ────────────────────────────────────────────────────────
  if (action === 'portal') {
    const profileResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${user.id}&select=stripe_customer_id&limit=1`,
      { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } }
    );
    const profiles = profileResp.ok ? await profileResp.json() : [];
    const customerId = profiles?.[0]?.stripe_customer_id;

    if (!customerId) return res.status(400).json({ error: 'No billing account found' });

    const portalSession = await stripe.billingPortal.sessions.create({
      customer:   customerId,
      return_url: `${origin}/dashboard.html`,
    });
    return res.status(200).json({ url: portalSession.url });
  }

  return res.status(400).json({ error: 'action must be checkout or portal' });
}
