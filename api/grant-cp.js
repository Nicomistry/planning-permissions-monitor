// POST /api/grant-cp
// Body: { requestId, userId, decision: 'granted' | 'denied' }
// Uses Supabase service role via REST API — no SDK import needed

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

  // Helpers
  const base = SUPABASE_URL;
  const svcHeaders = {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'apikey':        SUPABASE_SERVICE_KEY,
    'Prefer':        'return=minimal',
  };

  // Verify caller JWT
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No auth token' });

  const userResp = await fetch(`${base}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: SUPABASE_SERVICE_KEY },
  });
  if (!userResp.ok) return res.status(401).json({ error: 'Invalid token' });
  const caller = await userResp.json();

  // Verify caller is admin
  const profileResp = await fetch(
    `${base}/rest/v1/profiles?user_id=eq.${caller.id}&select=is_admin`,
    { headers: { ...svcHeaders, Prefer: 'return=representation' } }
  );
  const profiles = await profileResp.json();
  if (!profiles?.[0]?.is_admin) return res.status(403).json({ error: 'Not admin' });

  const { requestId, userId, decision } = req.body || {};
  if (!requestId || !userId || !decision) {
    return res.status(400).json({ error: 'requestId, userId, decision required' });
  }

  // Update request status
  const reqResp = await fetch(
    `${base}/rest/v1/control_panel_requests?id=eq.${requestId}`,
    {
      method:  'PATCH',
      headers: svcHeaders,
      body: JSON.stringify({ status: decision, reviewed_at: new Date().toISOString(), reviewed_by: caller.id }),
    }
  );
  if (!reqResp.ok) {
    const err = await reqResp.text();
    return res.status(500).json({ error: 'Failed to update request: ' + err });
  }

  // If granted, set cp_runs_remaining = 1
  if (decision === 'granted') {
    const profResp = await fetch(
      `${base}/rest/v1/profiles?user_id=eq.${userId}`,
      {
        method:  'PATCH',
        headers: svcHeaders,
        body: JSON.stringify({ cp_runs_remaining: 1 }),
      }
    );
    if (!profResp.ok) {
      const err = await profResp.text();
      return res.status(500).json({ error: 'Request updated but profile failed: ' + err });
    }
  }

  return res.status(200).json({ ok: true });
}
