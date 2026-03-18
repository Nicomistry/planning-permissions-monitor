// POST /api/stripe-manage
// action: 'checkout' — create Stripe Checkout session (body: { action, planKey })
// action: 'portal'   — create Stripe Customer Portal session (body: { action })
//
// TEST MODE — swap STRIPE_SECRET_KEY to sk_live_ for production.

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const STRIPE_SECRET_KEY    = process.env.STRIPE_SECRET_KEY;
  const STARTER_PRICE_ID     = process.env.STRIPE_STARTER_PRICE_ID;
  const PRO_PRICE_ID         = process.env.STRIPE_PRO_PRICE_ID;
  const SUPABASE_URL         = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe not configured' });

  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' });

  const { action, planKey } = req.body || {};
  const stripe  = new Stripe(STRIPE_SECRET_KEY);
  const origin  = req.headers.origin || 'https://pm-sand.vercel.app';

  // ── Checkout ──────────────────────────────────────────────────────────────
  if (!action || action === 'checkout') {
    if (!STARTER_PRICE_ID || !PRO_PRICE_ID) {
      return res.status(500).json({ error: 'Stripe prices not configured' });
    }
    if (!['starter', 'pro'].includes(planKey)) {
      return res.status(400).json({ error: 'planKey must be starter or pro' });
    }
    const priceId = planKey === 'pro' ? PRO_PRICE_ID : STARTER_PRICE_ID;
    const session = await stripe.checkout.sessions.create({
      mode:                 'subscription',
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
    const { data: profile } = await sb
      .from('profiles')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      return res.status(400).json({ error: 'No billing account found' });
    }
    const portalSession = await stripe.billingPortal.sessions.create({
      customer:   profile.stripe_customer_id,
      return_url: `${origin}/dashboard.html`,
    });
    return res.status(200).json({ url: portalSession.url });
  }

  return res.status(400).json({ error: 'action must be checkout or portal' });
}
