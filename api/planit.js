// Vercel serverless function — proxies PlanIt API to avoid browser CORS restrictions
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { council, uid, recent = '60', pg_sz = '200', app_state = 'Undecided', pg = '1' } = req.query;

  if (!council) {
    return res.status(400).json({ error: 'council param required' });
  }

  let url;

  if (uid) {
    // Individual application detail — use /planapplic/{council}/{uid}/json
    // This is the only correct pattern; ?uid= on the search endpoint returns HTTP 400
    url = `https://www.planit.org.uk/planapplic/${encodeURIComponent(council)}/${uid}/json`;
  } else {
    // List lookup — recent undecided applications
    const params = new URLSearchParams({
      auth:      council,
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
