// POST /api/grant-cp
// Body: { requestId, userId, decision: 'granted' | 'denied' }
// Uses service role to bypass RLS when updating profiles

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL         = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase env vars not configured' });
  }

  // Service role client — bypasses RLS
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Verify caller is an admin via their JWT
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No auth token' });

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: callerProfile } = await admin.from('profiles').select('is_admin').eq('user_id', user.id).single();
  if (!callerProfile?.is_admin) return res.status(403).json({ error: 'Not admin' });

  const { requestId, userId, decision } = req.body || {};
  if (!requestId || !userId || !decision) return res.status(400).json({ error: 'requestId, userId, decision required' });

  // Update request status
  const { error: reqErr } = await admin.from('control_panel_requests').update({
    status: decision,
    reviewed_at: new Date().toISOString(),
    reviewed_by: user.id,
  }).eq('id', requestId);
  if (reqErr) return res.status(500).json({ error: reqErr.message });

  // If granted, set cp_runs_remaining = 1
  if (decision === 'granted') {
    const { error: profErr } = await admin.from('profiles')
      .update({ cp_runs_remaining: 1 })
      .eq('user_id', userId);
    if (profErr) return res.status(500).json({ error: 'Request updated but profile failed: ' + profErr.message });
  }

  return res.status(200).json({ ok: true });
}
