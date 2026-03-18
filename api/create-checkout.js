// POST /api/create-checkout
// Creates a Stripe Checkout session for the selected plan.
// Body: { planKey: 'starter' | 'pro', userId, userEmail }
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

  const STRIPE_SECRET_KEY     = process.env.STRIPE_SECRET_KEY;      // sk_test_...
  const STARTER_PRICE_ID      = process.env.STRIPE_STARTER_PRICE_ID;
  const PRO_PRICE_ID          = process.env.STRIPE_PRO_PRICE_ID;
  const SUPABASE_URL          = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

  if (!STRIPE_SECRET_KEY || !STARTER_PRICE_ID || !PRO_PRICE_ID) {
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  // Verify caller is authenticated
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' });

  const { planKey } = req.body || {};
  if (!['starter', 'pro'].includes(planKey)) {
    return res.status(400).json({ error: 'planKey must be starter or pro' });
  }

  const priceId = planKey === 'pro' ? PRO_PRICE_ID : STARTER_PRICE_ID;
  const stripe  = new Stripe(STRIPE_SECRET_KEY);

  const origin = req.headers.origin || 'https://pm-sand.vercel.app';

  const session = await stripe.checkout.sessions.create({
    mode:                'subscription',
    payment_method_types: ['card'],
    line_items:          [{ price: priceId, quantity: 1 }],
    client_reference_id: user.id,
    customer_email:      user.email,
    success_url:         `${origin}/dashboard.html?welcome=1`,
    cancel_url:          `${origin}/pricing.html?cancelled=1`,
    metadata:            { user_id: user.id, plan_key: planKey },
  });

  return res.status(200).json({ url: session.url });
}
