// POST /api/billing-portal
// Creates a Stripe Customer Portal session so users can manage their subscription.
// Requires a valid Supabase JWT (user must be logged in).
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
  const SUPABASE_URL         = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe not configured' });

  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' });

  const { data: profile } = await sb
    .from('profiles')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .single();

  if (!profile?.stripe_customer_id) {
    return res.status(400).json({ error: 'No billing account found' });
  }

  const stripe  = new Stripe(STRIPE_SECRET_KEY);
  const origin  = req.headers.origin || 'https://pm-sand.vercel.app';

  const portalSession = await stripe.billingPortal.sessions.create({
    customer:   profile.stripe_customer_id,
    return_url: `${origin}/dashboard.html`,
  });

  return res.status(200).json({ url: portalSession.url });
}
