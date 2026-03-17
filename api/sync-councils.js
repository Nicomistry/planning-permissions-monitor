// POST /api/sync-councils  (admin-only — called once from admin panel)
// Fetches all active UK councils from planit.org.uk and upserts into Supabase planit_areas table.
// Fetches by area_type to stay within PlanIt's response-size limit.

import { createClient } from '@supabase/supabase-js';

const AREA_TYPES = [
  'London Borough',
  'English Unitary Authority',
  'English District',
  'English County',
  'Metropolitan Borough',
  'Scottish Council',
  'Welsh Principal Area',
  'Northern Ireland District',
  'National Park',
  'Combined Planning Authority',
  'Council District',
  'Other Planning Entity',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
  );

  const allAreas = [];
  const errors   = [];

  for (const areaType of AREA_TYPES) {
    try {
      const url = `https://www.planit.org.uk/api/areas/json?area_type=${encodeURIComponent(areaType)}&pg_sz=200&select=area_id,area_name,area_type`;
      const upstream = await fetch(url, {
        headers: { 'User-Agent': 'PPM-Scanner/1.0', 'Accept': 'application/json' },
      });

      if (!upstream.ok) {
        errors.push(`${areaType}: HTTP ${upstream.status}`);
        continue;
      }

      const data = await upstream.json();
      if (!Array.isArray(data.records)) {
        errors.push(`${areaType}: no records`);
        continue;
      }

      allAreas.push(...data.records.map(r => ({
        area_id:   r.area_id,
        area_name: r.area_name,
        area_type: r.area_type,
        synced_at: new Date().toISOString(),
      })));
    } catch (err) {
      errors.push(`${areaType}: ${err.message}`);
    }
  }

  if (allAreas.length === 0) {
    return res.status(502).json({ error: 'No areas fetched from PlanIt', errors });
  }

  // Deduplicate by area_id (same area can appear in multiple types)
  const seen    = new Set();
  const unique  = allAreas.filter(a => { if (seen.has(a.area_id)) return false; seen.add(a.area_id); return true; });

  // Upsert in batches of 100
  const BATCH = 100;
  let upserted = 0;
  for (let i = 0; i < unique.length; i += BATCH) {
    const { error } = await sb
      .from('planit_areas')
      .upsert(unique.slice(i, i + BATCH), { onConflict: 'area_id' });
    if (error) { errors.push(`upsert batch ${i}: ${error.message}`); }
    else upserted += Math.min(BATCH, unique.length - i);
  }

  return res.status(200).json({
    fetched:  allAreas.length,
    unique:   unique.length,
    upserted,
    errors:   errors.length ? errors : undefined,
  });
}
