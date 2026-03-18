// POST /api/trigger-scan
// Validates the user has access (active subscription OR manual cp_runs_remaining),
// enforces council limit by plan tier, then returns ok.
// Uses raw fetch (no Supabase SDK) to keep bundle minimal.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Server misconfigured' });

  const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_KEY}`, 'apikey': SUPABASE_KEY, ...(opts.headers || {}) },
  });

  const { userId, councils: requestedCouncils = [] } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });

  // 1. Load profile + user_plan in parallel
  const [profileResp, planResp] = await Promise.all([
    sb(`profiles?user_id=eq.${userId}&select=cp_runs_remaining&limit=1`),
    sb(`user_plans?user_id=eq.${userId}&select=status,plan_id,plans(council_limit)&limit=1`),
  ]);

  const profileRows = profileResp.ok ? await profileResp.json() : [];
  const planRows    = planResp.ok    ? await planResp.json()    : [];

  const profile      = profileRows?.[0];
  const userPlan     = planRows?.[0];
  const runsLeft     = profile?.cp_runs_remaining ?? 0;
  const subActive    = userPlan?.status === 'active';
  const councilLimit = userPlan?.plans?.council_limit ?? null;

  // 2. Access check
  if (!subActive && runsLeft < 1) {
    return res.status(403).json({ error: 'No scan access. Subscribe or request a free run from the admin.', code: 'NO_ACCESS' });
  }

  // 3. Council limit enforcement
  let councils = requestedCouncils;
  let skipped  = [];
  if (councilLimit !== null && councils.length > councilLimit) {
    skipped  = councils.slice(councilLimit);
    councils = councils.slice(0, councilLimit);
  }

  // 4. Deduct/update credits
  const patch = subActive
    ? { cp_last_run_at: new Date().toISOString() }
    : { cp_runs_remaining: runsLeft - 1, cp_last_run_at: new Date().toISOString() };

  await sb(`profiles?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });

  return res.status(200).json({ ok: true, councils, skipped });
}
