// POST /api/prospect-agent
// Body: { messages: [], prospectEmail: string, prospectName: string }
// Returns: { reply: string, reportSent: boolean }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  const SUPABASE_URL   = process.env.SUPABASE_URL;
  const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY;

  if (!OPENROUTER_KEY) {
    console.error('OPENROUTER_API_KEY not set');
    return res.status(200).json({ reply: 'Service misconfigured — please try again later.', reportSent: false });
  }

  const { messages = [], prospectEmail = '', prospectName = '' } = req.body || {};

  // ── 1. Look up prospect's trade from demo_requests ─────────────────────────
  let trade = 'tradesperson';
  if (prospectEmail && SUPABASE_URL && SUPABASE_KEY) {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/demo_requests?email=eq.${encodeURIComponent(prospectEmail)}&select=trade&order=created_at.desc&limit=1`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      const rows = await r.json();
      if (rows?.[0]?.trade) trade = rows[0].trade;
    } catch (e) {
      console.warn('Trade lookup failed:', e.message);
    }
  }

  // ── 2. System prompt ────────────────────────────────────────────────────────
  const systemPrompt = `You are PPM's planning assistant. Your goal is to collect the prospect's working area and project size so you can generate their personalised leads report.

You already know their trade: ${trade}.

Confirm their trade warmly in your first message (e.g. "Great — I can see you're a ${trade}. Let me find leads in your area that match exactly what you're looking for."), then ask:
1. What area they work in (town, city, or postcode)
2. Typical project size: small (extensions/lofts), medium (1–5 units), large (6+ new builds)

Rules:
- One question at a time
- Max 3 sentences per message
- Warm, professional, construction-industry tone
- Never mention Claude, Anthropic, or AI
- If asked what you are: "PPM's planning assistant"
- When you have BOTH area AND project size, respond ONLY with this exact JSON and nothing else:
  {"ready": true, "area": "[area the user gave]", "scale": "[small|medium|large]"}
- Never include JSON in any other message
- Never make up lead data or statistics`;

  // ── 3. Call OpenRouter ──────────────────────────────────────────────────────
  let replyText = '';
  try {
    const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'HTTP-Referer':  'https://ppm.build',
        'X-Title':       'PPM Prospect Agent',
      },
      body: JSON.stringify({
        model:      'anthropic/claude-3-5-haiku',
        max_tokens: 300,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
      }),
    });

    const orData = await orRes.json();

    if (!orRes.ok) {
      console.error('OpenRouter error:', JSON.stringify(orData));
      return res.status(200).json({
        reply:      'I had a problem generating a response — please try again.',
        reportSent: false,
      });
    }

    replyText = orData.choices?.[0]?.message?.content?.trim() || '';
  } catch (err) {
    console.error('OpenRouter fetch error:', err.message);
    return res.status(200).json({
      reply:      'Connection error — please try again in a moment.',
      reportSent: false,
    });
  }

  // ── 4. Check whether the model signalled ready ──────────────────────────────
  let readyPayload = null;
  try {
    const stripped = replyText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    const parsed = JSON.parse(stripped);
    if (parsed?.ready === true && parsed.area && parsed.scale) {
      readyPayload = parsed;
    }
  } catch (_) {}

  if (readyPayload) {
    // Step 2B placeholder — report generation added next
    return res.status(200).json({
      reply: `Perfect — I'm generating your leads report now. I'll send it straight to ${prospectEmail || 'your inbox'}. Just a moment…`,
      reportSent: false,
    });
  }

  // ── 5. Plain conversational reply ──────────────────────────────────────────
  return res.status(200).json({ reply: replyText, reportSent: false });
}
