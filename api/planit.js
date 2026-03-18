// Vercel serverless function — proxies PlanIt API to avoid browser CORS restrictions
// Resolves council name → planit_auth from council_portal_configs (canonical source),
// falls back to planit_areas area_id, then raw council name string.
// Uses raw fetch for all DB calls (no Supabase SDK) to keep bundle minimal.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { council, uid, recent = '60', pg_sz = '200', app_state = 'Undecided', pg = '1' } = req.query;

  if (!council) {
    return res.status(400).json({ error: 'council param required' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  const sbHeaders = {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'apikey':        SUPABASE_KEY,
  };

  // Resolve council name → planit auth identifier
  let authParam = council;
  try {
    // Primary: council_portal_configs.planit_auth (ilike match)
    const cfgResp = await fetch(
      `${SUPABASE_URL}/rest/v1/council_portal_configs?council_name=ilike.${encodeURIComponent(council)}&select=planit_auth&planit_auth=not.is.null&limit=1`,
      { headers: sbHeaders }
    );
    const cfgRows = cfgResp.ok ? await cfgResp.json() : [];
    if (cfgRows?.[0]?.planit_auth) {
      authParam = cfgRows[0].planit_auth;
    } else {
      // Fallback: planit_areas area_id via starts-with match
      const areaResp = await fetch(
        `${SUPABASE_URL}/rest/v1/planit_areas?area_name=ilike.${encodeURIComponent(council)}*&select=area_id&order=area_name.asc&limit=1`,
        { headers: sbHeaders }
      );
      const areaRows = areaResp.ok ? await areaResp.json() : [];
      if (areaRows?.[0]?.area_id) {
        authParam = String(areaRows[0].area_id);
      } else {
        // Last resort: lowercase slug
        authParam = council.toLowerCase().replace(/\s+/g, '_');
      }
    }
  } catch (_) {
    authParam = council.toLowerCase().replace(/\s+/g, '_');
  }

  let url;
  if (uid) {
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
      return res.status(upstream.status).json({
        error: `PlanIt returned ${upstream.status} for council="${council}" (auth=${authParam})`,
      });
    }

    const data = await upstream.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
