// GET  /api/admin-councils?council=X&uid=Y  — council contact lookup (was council-contact.js)
// POST /api/admin-councils                  — sync councils from PlanIt (was sync-councils.js, admin-only)

import { createClient } from '@supabase/supabase-js';

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

  const SUPABASE_URL         = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  // ── GET — council contact lookup ──────────────────────────────────────────
  if (req.method === 'GET') {
    const { council, uid } = req.query;
    if (!council || !uid) {
      return res.status(400).json({ error: 'council and uid params required' });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: config, error } = await supabase
      .from('council_portal_configs')
      .select('software_type, portal_base_url, tascomi_api_key, has_rest_api')
      .ilike('council_name', `%${council}%`)
      .limit(1)
      .maybeSingle();

    if (error || !config || !config.has_rest_api || !config.tascomi_api_key) {
      return res.status(200).json({ agent_email: null, agent_phone: null, source: 'unavailable' });
    }
    try {
      const appResp = await fetch(
        `${config.portal_base_url}/rest/v1/planning_applications?reference=${encodeURIComponent(uid)}&api_key=${config.tascomi_api_key}`,
        { headers: { Accept: 'application/json', 'User-Agent': 'PPM-Scanner/1.0' } }
      );
      if (!appResp.ok) return res.status(200).json({ agent_email: null, agent_phone: null, source: 'api-error' });
      const appData = await appResp.json();
      const appId = appData?.data?.[0]?.id;
      if (!appId) return res.status(200).json({ agent_email: null, agent_phone: null, source: 'no-match' });

      const cResp = await fetch(
        `${config.portal_base_url}/rest/v1/contacts?application_id=${appId}&contact_type=agent&api_key=${config.tascomi_api_key}`,
        { headers: { Accept: 'application/json', 'User-Agent': 'PPM-Scanner/1.0' } }
      );
      if (!cResp.ok) return res.status(200).json({ agent_email: null, agent_phone: null, source: 'contact-error' });
      const cData = await cResp.json();
      const agent = cData?.data?.[0];
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

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user || user.email !== ADMIN_EMAIL) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const errors = [];
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
          return data.records.map(r => ({ area_id: r.area_id, area_name: r.area_name, area_type: r.area_type, synced_at: new Date().toISOString() }));
        } catch (err) { errors.push(`${areaType}: ${err.message}`); return []; }
      })
    );
    const allAreas = results.flat();

    if (allAreas.length === 0) return res.status(502).json({ error: 'No areas fetched from PlanIt', errors });

    const seen = new Set();
    const unique = allAreas.filter(a => { if (seen.has(a.area_id)) return false; seen.add(a.area_id); return true; });

    let upserted = 0;
    for (let i = 0; i < unique.length; i += 100) {
      const { error } = await sb.from('planit_areas').upsert(unique.slice(i, i + 100), { onConflict: 'area_id' });
      if (error) errors.push(`upsert batch ${i}: ${error.message}`);
      else upserted += Math.min(100, unique.length - i);
    }
    return res.status(200).json({ fetched: allAreas.length, unique: unique.length, upserted, errors: errors.length ? errors : undefined });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
