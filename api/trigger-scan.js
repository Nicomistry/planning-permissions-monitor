// POST /api/trigger-scan
// Body: { userId }
// Triggers the 'planning-scraper' Trigger.dev task server-side.
// Requires TRIGGER_SECRET_KEY in env vars (never expose this client-side).

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const TRIGGER_SECRET_KEY = process.env.TRIGGER_SECRET_KEY;
  if (!TRIGGER_SECRET_KEY) {
    return res.status(500).json({ error: 'TRIGGER_SECRET_KEY not configured' });
  }

  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const resp = await fetch('https://api.trigger.dev/v3/tasks/planning-scraper/trigger', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${TRIGGER_SECRET_KEY}`,
    },
    body: JSON.stringify({ payload: { userId } }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    return res.status(502).json({ error: 'Trigger.dev error: ' + err });
  }

  const data = await resp.json();
  return res.status(200).json({ ok: true, runId: data.id });
}
