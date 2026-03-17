// GET /api/get-report?token=<uuid>
// Public endpoint — fetches a shared report by token using service role.
// Using service role here avoids the USING(true) RLS policy on shared_reports,
// so the table RLS can restrict direct client access without blocking this route.

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'token param required' });

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
  );

  const { data, error } = await sb
    .from('shared_reports')
    .select('leads_data, expires_at, created_at, label')
    .eq('token', token)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Report not found' });
  if (new Date(data.expires_at) < new Date()) {
    return res.status(410).json({ error: 'Report has expired' });
  }

  return res.status(200).json(data);
}
