// Vercel serverless function — proxies PlanIt API to avoid browser CORS restrictions
// Resolves council name → planit_auth from council_portal_configs (canonical source),
// falls back to planit_areas area_id, then raw council name string.

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { council, uid, recent = '60', pg_sz = '200', app_state = 'Undecided', pg = '1' } = req.query;

  if (!council) {
    return res.status(400).json({ error: 'council param required' });
  }

  // Resolve council name → planit_auth from council_portal_configs (canonical source),
  // then fall back to planit_areas area_id, then raw name.
  let authParam = council;
  try {
    const sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
    );

    // Primary: council_portal_configs.planit_auth
    const { data: cfg } = await sb
      .from('council_portal_configs')
      .select('planit_auth')
      .ilike('council_name', council)
      .not('planit_auth', 'is', null)
      .neq('planit_auth', '')
      .limit(1)
      .maybeSingle();

    if (cfg?.planit_auth) {
      authParam = cfg.planit_auth;
    } else {
      // Fallback: planit_areas area_id (numeric) via starts-with match
      const { data: area } = await sb
        .from('planit_areas')
        .select('area_id')
        .ilike('area_name', `${council}%`)
        .order('area_name', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (area?.area_id) {
        authParam = String(area.area_id);
      } else {
        // Last resort: lowercase the name (PlanIt slugs are typically lowercase)
        authParam = council.toLowerCase().replace(/\s+/g, '_');
      }
    }
  } catch (_) {
    // DB unavailable — fall back to lowercase name slug
    authParam = council.toLowerCase().replace(/\s+/g, '_');
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
      console.error(`PlanIt ${upstream.status} for auth=${authParam} council=${council} url=${url}`);
      return res.status(upstream.status).json({ error: `PlanIt returned ${upstream.status} for council="${council}" (auth=${authParam})` });
    }

    const data = await upstream.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
