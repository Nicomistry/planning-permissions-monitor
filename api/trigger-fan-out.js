// POST /api/trigger-fan-out
// Admin-only: queues a background Trigger.dev job that scans every unique
// council across all users' preferences and fans out leads to each user.
// No cp_runs_remaining check — this is an admin operation, not user-quota-gated.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
  const TRIGGER_KEY   = process.env.TRIGGER_SECRET_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY || !TRIGGER_KEY) {
    return res.status(500).json({ error: 'Server misconfigured — env vars missing' });
  }

  // 1. Verify caller JWT
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No auth token' });

  const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: SUPABASE_KEY },
  });
  if (!userResp.ok) return res.status(401).json({ error: 'Invalid token' });
  const caller = await userResp.json();

  // 2. Verify caller is admin
  const profileResp = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${caller.id}&select=is_admin&limit=1`,
    {
      headers: {
        apikey:        SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    },
  );
  const profiles = await profileResp.json();
  if (!profiles?.[0]?.is_admin) {
    return res.status(403).json({ error: 'Admin only' });
  }

  // 3. Queue the fan-out Trigger.dev job
  const triggerResp = await fetch(
    'https://api.trigger.dev/api/v1/tasks/planning-scraper/trigger',
    {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${TRIGGER_KEY}`,
      },
      body: JSON.stringify({ payload: { fanOut: true } }),
    },
  );

  const triggerData = await triggerResp.json();
  if (!triggerResp.ok) {
    return res.status(502).json({ error: 'Trigger.dev error', detail: triggerData });
  }

  return res.status(200).json({ ok: true, runId: triggerData.id });
}
