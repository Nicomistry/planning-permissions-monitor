// GET /api/live-leads
// Returns the top 10 highest-scored recent leads for the homepage hero.
// Uses service role server-side — clients never touch Supabase directly.
// Only safe, non-personal fields are returned (no user_id, applicant info, etc.)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  // Cache for 20 minutes via CDN / browser
  res.setHeader('Cache-Control', 's-maxage=1200, stale-while-revalidate=60');

  const SUPABASE_URL          = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  // Query top 10 leads by score, limited to the last 30 days
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?select=address,council,app_type,opportunity_score,priority&scraped_date=gte.${since}&order=opportunity_score.desc&limit=10`,
    {
      headers: {
        'apikey':        SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Accept':        'application/json',
      },
    }
  );

  if (!resp.ok) {
    return res.status(502).json({ error: 'Failed to fetch leads' });
  }

  const leads = await resp.json();

  // Strip anything sensitive — only return the five display fields
  const safe = leads.map(l => ({
    address:   l.address,
    council:   l.council,
    app_type:  l.app_type,
    score:     l.opportunity_score,
    priority:  l.priority,
  }));

  return res.status(200).json({ leads: safe, fetched_at: new Date().toISOString() });
}
