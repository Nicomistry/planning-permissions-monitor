// POST /api/prospect-agent
// Thin wrapper around /api/ppm-assistant.
// Handles conversation logging to prospect_conversations,
// then delegates all AI logic to the central engine.
//
// Body: { messages: [], prospectEmail: string, prospectName: string }
// Returns: { reply: string, reportSent: boolean }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  const { messages = [], prospectEmail = '', prospectName = '' } = req.body || {};

  // ── 1. Forward to ppm-assistant (central AI engine) ───────────────────────
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://ppm.build';

  let replyText  = '';
  let reportSent = false;

  try {
    const aiRes = await fetch(`${baseUrl}/api/ppm-assistant`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caller_type:    'prospect',
        messages,
        prospect_email: prospectEmail,
        prospect_name:  prospectName,
        user_id:        null,
      }),
    });

    const aiData = await aiRes.json();
    replyText  = aiData.reply  || 'Sorry, I had a problem — please try again.';
    reportSent = aiData.report_sent || false;
  } catch (err) {
    console.error('ppm-assistant call failed:', err.message);
    replyText = 'Connection error — please try again in a moment.';
  }

  // ── 2. Log conversation to prospect_conversations (every turn) ────────────
  if (SUPABASE_URL && SUPABASE_KEY && prospectEmail) {
    const svcH = {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
    };

    const updatedMessages = [
      ...messages,
      { role: 'assistant', content: replyText },
    ];

    try {
      // Find existing conversation row for this prospect
      const findRes = await fetch(
        `${SUPABASE_URL}/rest/v1/prospect_conversations?prospect_email=eq.${encodeURIComponent(prospectEmail)}&select=id&order=created_at.desc&limit=1`,
        { headers: svcH }
      );
      const existing = await findRes.json();

      if (existing?.[0]?.id) {
        // Update existing row
        await fetch(
          `${SUPABASE_URL}/rest/v1/prospect_conversations?id=eq.${existing[0].id}`,
          {
            method:  'PATCH',
            headers: { ...svcH, Prefer: 'return=minimal' },
            body: JSON.stringify({
              messages:    updatedMessages,
              ...(reportSent ? { report_sent: true } : {}),
            }),
          }
        );
      } else {
        // Insert new row
        await fetch(
          `${SUPABASE_URL}/rest/v1/prospect_conversations`,
          {
            method:  'POST',
            headers: { ...svcH, Prefer: 'return=minimal' },
            body: JSON.stringify({
              prospect_email: prospectEmail,
              prospect_name:  prospectName || null,
              messages:       updatedMessages,
              report_sent:    reportSent,
            }),
          }
        );
      }
    } catch (e) {
      console.warn('Conversation logging failed:', e.message);
    }
  }

  return res.status(200).json({ reply: replyText, reportSent });
}
