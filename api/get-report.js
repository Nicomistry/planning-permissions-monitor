// GET /api/get-report?token=<uuid>
// Public endpoint — fetches a shared report by token using service role.
// Uses raw fetch (no Supabase SDK) to keep bundle minimal.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'token param required' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/shared_reports?token=eq.${encodeURIComponent(token)}&select=leads_data,expires_at,created_at,label&limit=1`,
    {
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!resp.ok) return res.status(404).json({ error: 'Report not found' });

  const rows = await resp.json();
  const data = rows?.[0];
  if (!data) return res.status(404).json({ error: 'Report not found' });

  if (new Date(data.expires_at) < new Date()) {
    return res.status(410).json({ error: 'Report has expired' });
  }

  return res.status(200).json(data);
}
