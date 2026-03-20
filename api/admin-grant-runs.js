// POST /api/admin-grant-runs
// Body: { action: 'search', query: string }
//    or { action: 'grant',  userId: string, runs: number }
// Admin-only. Uses service role to query auth.users + profiles.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const svcHeaders = {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'apikey':        SUPABASE_KEY,
  };

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
    { headers: { ...svcHeaders, Prefer: 'return=representation' } }
  );
  const profiles = await profileResp.json();
  if (!profiles?.[0]?.is_admin) return res.status(403).json({ error: 'Admin only' });

  const { action, query, userId, runs } = req.body || {};

  // ── Search ────────────────────────────────────────────────────────────────
  if (action === 'search') {
    if (!query || query.trim().length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }

    // Search auth.users by email via admin API
    const usersResp = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?per_page=50`,
      { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } }
    );
    if (!usersResp.ok) return res.status(502).json({ error: 'Failed to list users' });
    const usersData = await usersResp.json();
    const allUsers = usersData.users || [];

    const q = query.trim().toLowerCase();
    const matched = allUsers.filter(u =>
      (u.email || '').toLowerCase().includes(q)
    );

    if (matched.length === 0) return res.status(200).json({ users: [] });

    // Fetch profiles for matched users to get cp_runs_remaining
    const ids = matched.map(u => u.id);
    const profsResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?user_id=in.(${ids.join(',')})&select=user_id,cp_runs_remaining`,
      { headers: { ...svcHeaders, Prefer: 'return=representation' } }
    );
    const profs = await profsResp.json();
    const profMap = {};
    (profs || []).forEach(p => { profMap[p.user_id] = p.cp_runs_remaining ?? 0; });

    const users = matched.map(u => ({
      id:               u.id,
      email:            u.email,
      created_at:       u.created_at,
      cp_runs_remaining: profMap[u.id] ?? 0,
    }));

    return res.status(200).json({ users });
  }

  // ── Grant ─────────────────────────────────────────────────────────────────
  if (action === 'grant') {
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const runsToSet = typeof runs === 'number' && runs > 0 ? runs : 1;

    const patchResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}`,
      {
        method:  'PATCH',
        headers: { ...svcHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({ cp_runs_remaining: runsToSet }),
      }
    );
    if (!patchResp.ok) {
      const err = await patchResp.text();
      return res.status(500).json({ error: 'Failed to update profile: ' + err });
    }

    return res.status(200).json({ ok: true, userId, cp_runs_remaining: runsToSet });
  }

  // ── List all users (for Intelligence tab) ─────────────────────────────────
  if (action === 'list') {
    const usersResp = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?per_page=200`,
      { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } }
    );
    if (!usersResp.ok) return res.status(502).json({ error: 'Failed to list users' });
    const usersData = await usersResp.json();
    const users = (usersData.users || []).map(u => ({
      id:         u.id,
      email:      u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
    }));
    return res.status(200).json({ users });
  }

  // ── Review CP request (was grant-cp.js) ───────────────────────────────────
  if (action === 'review') {
    const { requestId, userId: targetUserId, decision } = req.body || {};
    if (!requestId || !targetUserId || !decision) {
      return res.status(400).json({ error: 'requestId, userId, decision required' });
    }
    const reqResp = await fetch(
      `${SUPABASE_URL}/rest/v1/control_panel_requests?id=eq.${requestId}`,
      {
        method:  'PATCH',
        headers: { ...svcHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({ status: decision, reviewed_at: new Date().toISOString(), reviewed_by: caller.id }),
      }
    );
    if (!reqResp.ok) {
      return res.status(500).json({ error: 'Failed to update request: ' + await reqResp.text() });
    }
    if (decision === 'granted') {
      const profResp = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${targetUserId}`,
        {
          method:  'PATCH',
          headers: { ...svcHeaders, Prefer: 'return=minimal' },
          body: JSON.stringify({ cp_runs_remaining: 1 }),
        }
      );
      if (!profResp.ok) {
        return res.status(500).json({ error: 'Request updated but profile failed: ' + await profResp.text() });
      }
    }
    return res.status(200).json({ ok: true });
  }

  // ── Send leads to client (bypasses RLS via service role) ─────────────────
  if (action === 'send-leads') {
    const { targetUserId, leads } = req.body || {};
    if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });
    if (!Array.isArray(leads) || leads.length === 0) return res.status(400).json({ error: 'leads array required' });

    const today = new Date().toISOString().split('T')[0];

    // Build a stable uid fallback from address+council when PlanIt uid is absent
    const makeUid = l => {
      if (l.uid && l.uid.trim()) return l.uid.trim();
      const raw = `${l.address||''}|${l.councilName||l.council||''}`.slice(0, 80);
      return Buffer.from(raw).toString('base64').slice(0, 24);
    };

    // IMPORTANT: All rows must have IDENTICAL keys for PostgREST batch upsert (PGRST102).
    // Only include columns confirmed to exist in the leads table schema.
    // Excluded: agent_email, agent_phone, agent_name (not in schema cache → PGRST204).
    const rows = leads
      .filter(l => l.address || l.uid)
      .map(l => ({
        user_id:              targetUserId,
        uid:                  makeUid(l),
        council:              l.councilName || l.council || 'Unknown',
        address:              l.address || null,
        description:          l.description || null,
        app_type:             l.app_type || null,
        app_state:            l.app_state || null,
        start_date:           l.start_date || null,
        target_decision_date: l.target_decision_date || null,
        applicant_name:       l.applicant_name || null,
        planit_url:           l.planit_url || null,
        opportunity_score:    l.score || l.opportunity_score || 0,
        priority:             l.priority || 'LOW',
        dwelling_type:        l.dwelling_type || null,
        development_scale:    l.development_scale || null,
        unit_count:           l.unit_count || null,
        scraped_date:         today,
        admin_sent:           true,
      }));

    // Batch upsert in chunks of 200
    const CHUNK = 200;
    let saved = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const upsertResp = await fetch(
        `${SUPABASE_URL}/rest/v1/leads?on_conflict=user_id%2Cuid`,
        {
          method:  'POST',
          headers: { ...svcHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(chunk),
        }
      );
      if (!upsertResp.ok) {
        const errText = await upsertResp.text();
        return res.status(500).json({ error: 'Upsert failed: ' + errText });
      }
      saved += chunk.length;
    }

    return res.status(200).json({ ok: true, saved });
  }

  return res.status(400).json({ error: 'action must be "search", "grant", "list", "review", or "send-leads"' });
}
