// POST /api/trigger-scan
// Validates the user has access (active subscription OR manual cp_runs_remaining),
// enforces council limit by plan tier, then returns ok.
// The actual scan runs client-side via /api/planit.

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
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const { userId, councils: requestedCouncils = [] } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // 1. Load profile + user_plan + plan tier in parallel
  const [profileRes, planRes] = await Promise.all([
    sb.from('profiles').select('cp_runs_remaining').eq('user_id', userId).single(),
    sb.from('user_plans')
      .select('status, plan_id, plans(council_limit)')
      .eq('user_id', userId)
      .single(),
  ]);

  const profile     = profileRes.data;
  const userPlan    = planRes.data;
  const runsLeft    = profile?.cp_runs_remaining ?? 0;
  const subActive   = userPlan?.status === 'active';
  const councilLimit = userPlan?.plans?.council_limit ?? null; // null = unlimited

  // 2. Access check — active subscription OR manual credit
  if (!subActive && runsLeft < 1) {
    return res.status(403).json({
      error: 'No scan access. Subscribe or request a free run from the admin.',
      code:  'NO_ACCESS',
    });
  }

  // 3. Council limit enforcement (Starter = 3, Pro = unlimited)
  let councils = requestedCouncils;
  let skipped  = [];
  if (councilLimit !== null && councils.length > councilLimit) {
    skipped  = councils.slice(councilLimit);
    councils = councils.slice(0, councilLimit);
    console.log(`trigger-scan: council limit ${councilLimit} — skipped: ${skipped.join(', ')}`);
  }

  // 4. Deduct manual credit if no active subscription
  if (!subActive && runsLeft >= 1) {
    await sb.from('profiles').update({
      cp_runs_remaining: runsLeft - 1,
      cp_last_run_at:    new Date().toISOString(),
    }).eq('user_id', userId);
  } else {
    // Still update last run timestamp for subscribers
    await sb.from('profiles').update({
      cp_last_run_at: new Date().toISOString(),
    }).eq('user_id', userId);
  }

  return res.status(200).json({
    ok:       true,
    councils, // trimmed list — client uses this to run the scan
    skipped,  // councils that were cut due to plan limit
  });
}
