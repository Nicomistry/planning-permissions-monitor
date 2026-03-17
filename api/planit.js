// Vercel serverless function — proxies PlanIt API to avoid browser CORS restrictions
// Uses area_id (numeric) when provided for reliable council matching,
// falls back to council name string if no area_id supplied.

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { council, uid, recent = '60', pg_sz = '200', app_state = 'Undecided', pg = '1' } = req.query;

  if (!council) {
    return res.status(400).json({ error: 'council param required' });
  }

  // Resolve council name → area_id from DB for reliable matching
  let authParam = council;
  try {
    const sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
    );
    const { data } = await sb
      .from('planit_areas')
      .select('area_id')
      .ilike('area_name', council)
      .single();
    if (data?.area_id) authParam = String(data.area_id);
  } catch (_) {
    // table not seeded yet — fall back to name string
  }

  let url;

  if (uid) {
    // Individual application detail
    url = `https://www.planit.org.uk/planapplic/${encodeURIComponent(authParam)}/${uid}/json`;
  } else {
    const params = new URLSearchParams({
      auth:      authParam,
      recent:    recent,
      pg_sz:     pg_sz,
      app_state: app_state,
      pg:        pg,
      format:    'json',
    });
    url = `https://www.planit.org.uk/api/applics/json?${params}`;
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'PPM-Scanner/1.0',
        'Accept':     'application/json',
      },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `PlanIt returned ${upstream.status} for ${url}` });
    }

    const data = await upstream.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
