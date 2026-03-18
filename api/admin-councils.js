// GET  /api/admin-councils?council=X&uid=Y  — council contact lookup (was council-contact.js)
// POST /api/admin-councils                  — sync councils from PlanIt (was sync-councils.js, admin-only)
// Uses raw fetch for all DB/auth calls (no Supabase SDK) to keep bundle minimal.

const AREA_TYPES = [
  'London Borough', 'English Unitary Authority', 'English District', 'English County',
  'Metropolitan Borough', 'Scottish Council', 'Welsh Principal Area', 'Northern Ireland District',
  'National Park', 'Combined Planning Authority', 'Council District', 'Other Planning Entity',
];

const ADMIN_EMAIL = 'nicomistry@gmail.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const sbHeaders = {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'apikey':        SUPABASE_KEY,
  };

  // ── GET — council contact lookup ──────────────────────────────────────────
  if (req.method === 'GET') {
    const { council, uid } = req.query;
    if (!council || !uid) {
      return res.status(400).json({ error: 'council and uid params required' });
    }

    try {
      const cfgResp = await fetch(
        `${SUPABASE_URL}/rest/v1/council_portal_configs?council_name=ilike.*${encodeURIComponent(council)}*&select=software_type,portal_base_url,tascomi_api_key,has_rest_api&limit=1`,
        { headers: sbHeaders }
      );
      const cfgRows = await cfgResp.json();
      const config  = cfgRows?.[0];

      if (!config || !config.has_rest_api || !config.tascomi_api_key) {
        return res.status(200).json({ agent_email: null, agent_phone: null, source: 'unavailable' });
      }

      const appResp = await fetch(
        `${config.portal_base_url}/rest/v1/planning_applications?reference=${encodeURIComponent(uid)}&api_key=${config.tascomi_api_key}`,
        { headers: { Accept: 'application/json', 'User-Agent': 'PPM-Scanner/1.0' } }
      );
      if (!appResp.ok) return res.status(200).json({ agent_email: null, agent_phone: null, source: 'api-error' });
      const appData = await appResp.json();
      const appId   = appData?.data?.[0]?.id;
      if (!appId) return res.status(200).json({ agent_email: null, agent_phone: null, source: 'no-match' });

      const cResp = await fetch(
        `${config.portal_base_url}/rest/v1/contacts?application_id=${appId}&contact_type=agent&api_key=${config.tascomi_api_key}`,
        { headers: { Accept: 'application/json', 'User-Agent': 'PPM-Scanner/1.0' } }
      );
      if (!cResp.ok) return res.status(200).json({ agent_email: null, agent_phone: null, source: 'contact-error' });
      const cData = await cResp.json();
      const agent  = cData?.data?.[0];
      const agentName = agent ? [agent.first_name, agent.last_name].filter(Boolean).join(' ').trim() || null : null;
      return res.status(200).json({
        agent_email: agent?.email || null,
        agent_phone: agent?.mobile || agent?.telephone || null,
        agent_name:  agentName,
        source: 'idox-rest',
      });
    } catch (err) {
      return res.status(200).json({ agent_email: null, agent_phone: null, source: 'error', error: err.message });
    }
  }

  // ── POST — sync councils from PlanIt (admin-only) ─────────────────────────
  if (req.method === 'POST') {
    const authHeader = req.headers.authorization ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Unauthorised' });

    // Verify admin JWT
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY },
    });
    if (!userResp.ok) return res.status(403).json({ error: 'Forbidden' });
    const userData = await userResp.json();
    if (userData?.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });

    // Fetch all area types from PlanIt in parallel
    const errors  = [];
    const results = await Promise.all(
      AREA_TYPES.map(async (areaType) => {
        try {
          const upstream = await fetch(
            `https://www.planit.org.uk/api/areas/json?area_type=${encodeURIComponent(areaType)}&pg_sz=200&select=area_id,area_name,area_type`,
            { headers: { 'User-Agent': 'PPM-Scanner/1.0', Accept: 'application/json' } }
          );
          if (!upstream.ok) { errors.push(`${areaType}: HTTP ${upstream.status}`); return []; }
          const data = await upstream.json();
          if (!Array.isArray(data.records)) { errors.push(`${areaType}: no records`); return []; }
          return data.records.map(r => ({
            area_id:   r.area_id,
            area_name: r.area_name,
            area_type: r.area_type,
            synced_at: new Date().toISOString(),
          }));
        } catch (err) { errors.push(`${areaType}: ${err.message}`); return []; }
      })
    );

    const allAreas = results.flat();
    if (allAreas.length === 0) return res.status(502).json({ error: 'No areas fetched from PlanIt', errors });

    // Deduplicate
    const seen   = new Set();
    const unique = allAreas.filter(a => { if (seen.has(a.area_id)) return false; seen.add(a.area_id); return true; });

    // Upsert in batches of 100
    let upserted = 0;
    for (let i = 0; i < unique.length; i += 100) {
      const batch = unique.slice(i, i + 100);
      const upsertResp = await fetch(
        `${SUPABASE_URL}/rest/v1/planit_areas`,
        {
          method:  'POST',
          headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates' },
          body:    JSON.stringify(batch),
        }
      );
      if (!upsertResp.ok) {
        const err = await upsertResp.text();
        errors.push(`upsert batch ${i}: ${err}`);
      } else {
        upserted += batch.length;
      }
    }

    return res.status(200).json({
      fetched:  allAreas.length,
      unique:   unique.length,
      upserted,
      errors:   errors.length ? errors : undefined,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
