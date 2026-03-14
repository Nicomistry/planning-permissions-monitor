// POST /api/trigger-scan
// Body: { userId, councils? }
// 1. Verifies user has cp_runs_remaining > 0 (service role — bypasses RLS)
// 2. Triggers the Trigger.dev task
// 3. Deducts the run server-side (service role — client has no UPDATE permission)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const TRIGGER_SECRET_KEY = process.env.TRIGGER_SECRET_KEY;
  const SUPABASE_URL        = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!TRIGGER_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const { userId, councils } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });

  // ── 1. Check the user actually has a run available ────────────────────────
  const profileResp = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}&select=cp_runs_remaining,cp_last_run_at&limit=1`,
    {
      headers: {
        'apikey':        SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    }
  );

  if (!profileResp.ok) {
    return res.status(502).json({ error: 'Could not verify scan eligibility' });
  }

  const profiles = await profileResp.json();
  const profile  = profiles[0];

  if (!profile || (profile.cp_runs_remaining || 0) < 1) {
    return res.status(403).json({
      error: 'No scan runs available. Request access from the admin first.',
      code:  'NO_RUNS',
    });
  }

  // ── 2. Trigger the scan ───────────────────────────────────────────────────
  const triggerResp = await fetch('https://api.trigger.dev/api/v1/tasks/planning-scraper/trigger', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${TRIGGER_SECRET_KEY}`,
    },
    body: JSON.stringify({ payload: { userId, councils: councils || null } }),
  });

  if (!triggerResp.ok) {
    const err = await triggerResp.text();
    return res.status(502).json({ error: 'Trigger.dev error: ' + err });
  }

  const triggerData = await triggerResp.json();

  // ── 3. Deduct the run server-side (service role — bypasses RLS) ───────────
  await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}`,
    {
      method: 'PATCH',
      headers: {
        'apikey':        SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify({
        cp_runs_remaining: 0,
        cp_last_run_at:    new Date().toISOString(),
      }),
    }
  );

  return res.status(200).json({ ok: true, runId: triggerData.id });
}
