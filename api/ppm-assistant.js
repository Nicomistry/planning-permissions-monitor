// POST /api/ppm-assistant
// Central AI engine for PPM — handles both prospect and client callers.
//
// Body:
// {
//   caller_type:     "prospect" | "client",
//   messages:        [],          // full conversation history
//   user_id:         string|null, // client only
//   prospect_email:  string|null, // prospect only
//   prospect_name:   string|null  // prospect only
// }
//
// Response:
// {
//   reply:       string,
//   lead_cards:  [] | null,
//   stat_teaser: {} | null,
//   report_sent: boolean,
//   learned:     boolean
// }

const SUPABASE_HEADERS = (key) => ({
  'apikey':        key,
  'Authorization': `Bearer ${key}`,
  'Content-Type':  'application/json',
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL    = process.env.SUPABASE_URL;
  const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;
  const OPENROUTER_KEY  = process.env.OPENROUTER_API_KEY;
  const TRIGGER_KEY     = process.env.TRIGGER_SECRET_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY || !OPENROUTER_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const {
    caller_type    = 'prospect',
    messages       = [],
    user_id        = null,
    prospect_email = null,
    prospect_name  = null,
  } = req.body || {};

  // ── Rate limiting ──────────────────────────────────────────────────────────
  // Cap messages array to prevent token abuse on single calls
  const MAX_MESSAGES = caller_type === 'prospect' ? 10 : 20;
  if (!Array.isArray(messages) || messages.length > MAX_MESSAGES) {
    return res.status(429).json({ error: 'Too many messages in request — start a new conversation.' });
  }

  // Per-client daily call limit (stored in profiles.ai_calls_today / ai_calls_date)
  if (caller_type === 'client' && user_id) {
    try {
      const profRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${user_id}&select=ai_calls_today,ai_calls_date&limit=1`,
        { headers: SUPABASE_HEADERS(SUPABASE_KEY) }
      );
      const profRows = await profRes.json();
      const prof = profRows?.[0];
      const today = new Date().toISOString().slice(0, 10);
      const callsToday = (prof?.ai_calls_date === today) ? (prof.ai_calls_today || 0) : 0;
      const DAILY_LIMIT = 50;
      if (callsToday >= DAILY_LIMIT) {
        return res.status(429).json({ error: 'Daily AI call limit reached — resets at midnight UTC.' });
      }
      // Increment counter (best-effort, non-blocking)
      fetch(
        `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${user_id}`,
        {
          method:  'PATCH',
          headers: { ...SUPABASE_HEADERS(SUPABASE_KEY), Prefer: 'return=minimal' },
          body: JSON.stringify({ ai_calls_today: callsToday + 1, ai_calls_date: today }),
        }
      ).catch(() => {});
    } catch (e) {
      // Non-fatal — if counter check fails, allow the call through
      console.warn('Rate limit check failed:', e.message);
    }
  }

  const svcH = SUPABASE_HEADERS(SUPABASE_KEY);

  // ── STEP 1: Load ai_config ─────────────────────────────────────────────────
  let config = {
    assistant_name:        'PPM Assistant',
    tone:                  'warm, professional, construction-industry',
    forbidden_topics:      'competitors, politics, religion',
    prospect_pitch_style:  'tease_not_reveal',
    max_leads_in_context:  50,
    learning_enabled:      true,
    scraper_sources:       'fmb.org.uk,nhbc.co.uk,theconstructionindex.co.uk',
  };

  try {
    const cfgRes = await fetch(
      `${SUPABASE_URL}/rest/v1/ai_config?select=config_key,config_value`,
      { headers: svcH }
    );
    const cfgRows = await cfgRes.json();
    if (Array.isArray(cfgRows)) {
      cfgRows.forEach(({ config_key, config_value }) => {
        config[config_key] = config_key === 'max_leads_in_context'
          ? parseInt(config_value, 10) || 50
          : config_key === 'learning_enabled'
            ? config_value === 'true'
            : config_value;
      });
    }
  } catch (e) {
    console.warn('ai_config load failed — using defaults:', e.message);
  }

  // ── STEP 2: Load caller context ────────────────────────────────────────────
  let trade          = 'tradesperson';
  let area           = null;
  let clientLeads    = [];
  let priorMessages  = [];
  let conversationId = null;
  let statTeaser     = null;

  if (caller_type === 'prospect') {
    // Fetch trade from demo_requests
    if (prospect_email) {
      try {
        const dr = await fetch(
          `${SUPABASE_URL}/rest/v1/demo_requests?email=eq.${encodeURIComponent(prospect_email)}&select=trade&order=created_at.desc&limit=1`,
          { headers: svcH }
        );
        const drRows = await dr.json();
        if (drRows?.[0]?.trade) trade = drRows[0].trade;
      } catch (e) {
        console.warn('Trade lookup failed:', e.message);
      }
    }

    // Fetch lead stats for prospect area (counts only — no addresses)
    const latestUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    if (latestUserMsg.length > 2) {
      try {
        // Resolve area from message via postcodes.io
        const pcRes = await fetch(
          `https://api.postcodes.io/postcodes?q=${encodeURIComponent(latestUserMsg)}&limit=1`
        );
        const pcData = await pcRes.json();
        const district = pcData?.result?.[0]?.admin_district;
        if (district) {
          const statsRes = await fetch(
            `${SUPABASE_URL}/rest/v1/rpc/get_lead_stats_for_council`,
            {
              method: 'POST',
              headers: svcH,
              body: JSON.stringify({ council_name: district }),
            }
          );
          // Fallback: direct count query if RPC not available
          const countRes = await fetch(
            `${SUPABASE_URL}/rest/v1/leads?council=eq.${encodeURIComponent(district)}&select=priority`,
            { headers: { ...svcH, Prefer: 'count=exact' } }
          );
          const countData = await countRes.json();
          if (Array.isArray(countData)) {
            const total  = countData.length;
            const high   = countData.filter(l => l.priority === 'HIGH').length;
            const medium = countData.filter(l => l.priority === 'MEDIUM').length;
            statTeaser = { council: district, total, high, medium };
          }
        }
      } catch (e) {
        console.warn('Prospect stats lookup failed:', e.message);
      }
    }

  } else if (caller_type === 'client') {
    if (!user_id) {
      return res.status(400).json({ error: 'user_id required for client caller' });
    }

    // Fetch client leads — assistant is open to all logged-in clients
    try {
      const leadsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/leads?user_id=eq.${user_id}&select=id,address,council,app_type,dwelling_type,opportunity_score,priority,score_reasoning,target_decision_date,planit_url,council_url,applicant_name,agent_name,agent_email,agent_phone,postcode,description,uid,ward_name&order=opportunity_score.desc&limit=${config.max_leads_in_context}`,
        { headers: svcH }
      );
      clientLeads = (await leadsRes.json()) || [];
    } catch (e) {
      console.warn('Leads fetch failed:', e.message);
    }

    // Fetch trade + area from user_preferences
    try {
      const prefRes = await fetch(
        `${SUPABASE_URL}/rest/v1/user_preferences?user_id=eq.${user_id}&select=trade,area&limit=1`,
        { headers: svcH }
      );
      const prefRows = await prefRes.json();
      if (prefRows?.[0]) {
        trade = prefRows[0].trade || trade;
        area  = prefRows[0].area  || null;
      }
    } catch (e) {
      console.warn('Preferences fetch failed:', e.message);
    }

    // Fetch last conversation (last 10 messages for continuity)
    try {
      const convRes = await fetch(
        `${SUPABASE_URL}/rest/v1/client_conversations?user_id=eq.${user_id}&select=id,messages&order=updated_at.desc&limit=1`,
        { headers: svcH }
      );
      const convRows = await convRes.json();
      if (convRows?.[0]) {
        conversationId = convRows[0].id;
        priorMessages  = (convRows[0].messages || []).slice(-10);
      }
    } catch (e) {
      console.warn('Conversation history fetch failed:', e.message);
    }
  }

  // ── STEP 3: Market intelligence injection ──────────────────────────────────
  let intelligenceContext = [];
  const contextUsedIds    = [];
  const latestMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';

  if (latestMsg.length > 3) {
    try {
      // Extract first meaningful words for search
      const searchTerm = latestMsg.replace(/['"?!]/g, '').slice(0, 60);
      const miRes = await fetch(
        `${SUPABASE_URL}/rest/v1/market_intelligence?or=(content.ilike.*${encodeURIComponent(searchTerm)}*,title.ilike.*${encodeURIComponent(searchTerm)}*)&select=id,title,content,source_name,source_url,confidence&order=confidence.desc&limit=5`,
        { headers: svcH }
      );
      const miRows = await miRes.json();
      if (Array.isArray(miRows) && miRows.length) {
        intelligenceContext = miRows;
        miRows.forEach(r => contextUsedIds.push(r.id));
      }
    } catch (e) {
      console.warn('Market intelligence search failed:', e.message);
    }
  }

  // ── STEP 4: Build system prompt ────────────────────────────────────────────
  const intelligenceBlock = intelligenceContext.length
    ? '\n\nBACKGROUND KNOWLEDGE (cite source when using):\n' +
      intelligenceContext.map(r =>
        `- ${r.title}: ${r.content.slice(0, 300)}${r.source_name ? ` [Source: ${r.source_name}]` : ''}`
      ).join('\n')
    : '';

  const ukBenchmarks = `
UK construction contract value benchmarks (estimates only — always state this):
- Garage conversion: £10k–£25k
- Single storey extension: £20k–£45k
- Loft conversion: £30k–£60k
- Double storey extension: £40k–£80k
- Basement conversion: £50k–£150k
- New build detached: £120k–£350k
- New build flat (per unit): £80k–£150k
- New build apartment block (6+ units): £500k–£2m+`;

  let systemPrompt = `You are ${config.assistant_name}, a planning intelligence assistant for UK construction professionals.
Tone: ${config.tone}.
Never discuss: ${config.forbidden_topics}.
Never mention Claude, Anthropic, AI models, or OpenRouter.
If asked what you are: "${config.assistant_name}, PPM's planning intelligence system."
Keep all responses under 150 words unless returning JSON.
Always cite source when using background knowledge.
${ukBenchmarks}${intelligenceBlock}`;

  if (caller_type === 'prospect') {
    const statsLine = statTeaser
      ? `\nLead stats for ${statTeaser.council}: ${statTeaser.total} total applications, ${statTeaser.high} HIGH priority, ${statTeaser.medium} MEDIUM priority.`
      : '';

    systemPrompt += `

PROSPECT MODE — pitch style: ${config.prospect_pitch_style}.
You know their trade: ${trade}.
${statsLine}

Your goal: qualify the prospect and create desire for PPM without revealing real lead data.
1. Confirm their trade warmly
2. Ask what area they cover
3. Ask typical project size: small (extensions/lofts) / medium (1–5 units) / large (6+ new builds)
4. Once you have trade + area + scale: deliver a compelling pitch using lead stats and profit estimates
   - Tell them how many leads exist in their area
   - How many are HIGH priority
   - Estimated contract value range based on lead types
   - End with: "To see full details, addresses and contacts — your demo is the next step. Shall I confirm your booking?"

NEVER reveal: addresses, planning references, applicant names, or PlanIt URLs.
NEVER invent statistics — only use stats provided above.
Always end messages with a clear next step or question.`;

  } else {
    const leadsBlock = clientLeads.length
      ? `\nCLIENT LEADS — ${clientLeads.length} leads scraped from UK planning portals${area ? ` in ${area}` : ''}:\n` +
        clientLeads.map((l, i) => {
          const contact = [l.agent_name, l.agent_email, l.agent_phone].filter(Boolean).join(' | ');
          const url = l.council_url || l.planit_url || '';
          return `${i + 1}. [${l.priority || 'LOW'} ${l.opportunity_score || 0}/10] ${l.address} | ${l.council}${l.ward_name ? ` (${l.ward_name})` : ''} | ${l.app_type || '—'} | ${l.dwelling_type || '—'} | Ref:${l.uid || '—'} | Decision:${l.target_decision_date || 'TBC'}${contact ? ` | Contact: ${contact}` : ''}${url ? ` | URL: ${url}` : ''}\n   Description: ${(l.description || '').slice(0, 150)}`;
        }).join('\n')
      : '\nNo leads found yet — client needs to run a scan first.';

    systemPrompt += `

CLIENT MODE — you are a planning intelligence assistant for a ${trade} professional${area ? ` covering ${area}` : ''}.
${leadsBlock}

RULES:
- All lead data above is REAL, scraped from official UK planning portals. Never say you don't have data if it's in the list above.
- When asked about leads, scores, contacts or addresses: use ONLY the data above.
- Scores are out of 10. HIGH = 7+, MEDIUM = 4–6, LOW = 1–3.
- Contact details (agent name/email/phone) are the architects or agents who submitted the planning application — these are the people to reach out to.

When the client asks to SEE leads (e.g. "show my leads", "which are high priority", "leads in Barnet"):
Respond with ONLY this JSON:
{"action":"show_leads","leads":[...matching lead objects from the numbered list above, as full objects...],"explanation":"one sentence summary"}

For outreach message requests ("draft outreach", "write a message for [address]"):
Write a concise, professional note from a ${trade} to the homeowner/agent. Reference the specific project. Max 120 words.

For questions you cannot answer:
{"action":"learn","topic":"exact question asked"}

For fresh scan requests:
{"action":"trigger_scan","councils":["council1","council2"]}

For everything else: answer in plain text. Be specific, reference actual lead data. Never invent.`;
  }

  // ── STEP 5: Call OpenRouter ────────────────────────────────────────────────
  let replyText = '';
  try {
    const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'HTTP-Referer':  'https://ppm.build',
        'X-Title':       'PPM Assistant',
      },
      body: JSON.stringify({
        model:       'anthropic/claude-3-5-haiku',
        max_tokens:  800,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          ...(caller_type === 'client' ? priorMessages : []),
          ...messages,
        ],
      }),
    });

    const orData = await orRes.json();
    if (!orRes.ok) {
      const errMsg = orData?.error?.message || orData?.message || JSON.stringify(orData);
      console.error('OpenRouter error:', errMsg);
      return res.status(200).json({
        reply:       `Assistant error: ${errMsg}`,
        lead_cards:  null,
        stat_teaser: statTeaser,
        report_sent: false,
        learned:     false,
      });
    }
    replyText = orData.choices?.[0]?.message?.content?.trim() || '';
  } catch (err) {
    console.error('OpenRouter fetch error:', err.message);
    return res.status(200).json({
      reply:       'Connection error — please try again.',
      lead_cards:  null,
      stat_teaser: statTeaser,
      report_sent: false,
      learned:     false,
    });
  }

  // ── STEP 6: Parse response + act ──────────────────────────────────────────
  let leadCards  = null;
  let learned    = false;
  let actionTaken = false;

  // Strip possible markdown code fences
  const stripped = replyText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    const parsed = JSON.parse(stripped);

    // show_leads
    if (parsed?.action === 'show_leads' && Array.isArray(parsed.leads)) {
      leadCards  = parsed.leads;
      replyText  = parsed.explanation || `Here are ${leadCards.length} leads matching your request.`;
      actionTaken = true;
    }

    // learn
    if (parsed?.action === 'learn' && parsed.topic && config.learning_enabled) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/market_intelligence`, {
          method:  'POST',
          headers: { ...svcH, Prefer: 'return=minimal' },
          body: JSON.stringify({
            category:     'learned',
            title:        `Client asked: ${parsed.topic.slice(0, 120)}`,
            content:      'Question asked by client — answer unknown. Needs research.',
            trade_tags:   trade ? [trade] : [],
            region_tags:  area  ? [area]  : [],
            confidence:   0.3,
            learned_from: 'client_interaction',
          }),
        });
        learned   = true;
        replyText = `I don't have that information yet — I've flagged it for research. If it comes up again I'll have an answer ready for you.`;
      } catch (e) {
        console.warn('Learn INSERT failed:', e.message);
        replyText = `I don't have that information yet, but I've noted it.`;
      }
      actionTaken = true;
    }

    // trigger_scan
    if (parsed?.action === 'trigger_scan' && Array.isArray(parsed.councils) && TRIGGER_KEY) {
      try {
        await fetch('https://api.trigger.dev/api/v1/tasks/planning-scraper/trigger', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TRIGGER_KEY}` },
          body: JSON.stringify({ payload: { userId: user_id, councils: parsed.councils } }),
        });
        replyText   = `I've queued a fresh scan for ${parsed.councils.join(', ')}. Results will appear in your leads within a few minutes.`;
        actionTaken = true;
      } catch (e) {
        console.warn('Trigger scan failed:', e.message);
        replyText = `I tried to queue a scan but hit an error — please trigger it manually from your dashboard.`;
      }
    }
  } catch (_) {
    // Not JSON — plain text reply, use as-is
  }

  // ── Save conversation (client only) ────────────────────────────────────────
  if (caller_type === 'client' && user_id) {
    const updatedMessages = [
      ...priorMessages,
      ...messages,
      { role: 'assistant', content: replyText },
    ].slice(-40); // keep last 40 turns

    try {
      if (conversationId) {
        await fetch(
          `${SUPABASE_URL}/rest/v1/client_conversations?id=eq.${conversationId}`,
          {
            method:  'PATCH',
            headers: { ...svcH, Prefer: 'return=minimal' },
            body: JSON.stringify({
              messages:     updatedMessages,
              context_used: contextUsedIds,
            }),
          }
        );
      } else {
        await fetch(`${SUPABASE_URL}/rest/v1/client_conversations`, {
          method:  'POST',
          headers: { ...svcH, Prefer: 'return=minimal' },
          body: JSON.stringify({
            user_id,
            messages:     updatedMessages,
            context_used: contextUsedIds,
          }),
        });
      }
    } catch (e) {
      console.warn('Conversation save failed:', e.message);
    }
  }

  return res.status(200).json({
    reply:       replyText,
    lead_cards:  leadCards,
    stat_teaser: statTeaser,
    report_sent: false,
    learned,
  });
}
