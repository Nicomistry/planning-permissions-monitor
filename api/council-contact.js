// Vercel serverless function — enriches a planning application with agent contact
// details from the council's native portal API (Idox/Tascomi REST where available).
//
// Usage: GET /api/council-contact?council=Hackney&uid=2024/1234
// Returns: { agent_email, agent_phone, agent_name, source }
//
// source values:
//   "idox-rest"   → live data from Tascomi REST API
//   "unavailable" → council not in registry or no REST API configured
//   "no-match"    → council found but application reference not matched

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { council, uid } = req.query;
  if (!council || !uid) {
    return res.status(400).json({ error: 'council and uid params required' });
  }

  // 1. Look up council portal config
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
  );

  const { data: config, error } = await supabase
    .from('council_portal_configs')
    .select('software_type, portal_base_url, tascomi_api_key, has_rest_api')
    .ilike('council_name', `%${council}%`)
    .limit(1)
    .maybeSingle();

  if (error || !config || !config.has_rest_api || !config.tascomi_api_key) {
    return res.status(200).json({ agent_email: null, agent_phone: null, source: 'unavailable' });
  }

  // 2. Find the application in Tascomi by reference number
  try {
    const appUrl = `${config.portal_base_url}/rest/v1/planning_applications`
      + `?reference=${encodeURIComponent(uid)}&api_key=${config.tascomi_api_key}`;

    const appResp = await fetch(appUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'PPM-Scanner/1.0' },
    });

    if (!appResp.ok) {
      return res.status(200).json({ agent_email: null, agent_phone: null, source: 'api-error' });
    }

    const appData = await appResp.json();
    const appId = appData?.data?.[0]?.id;

    if (!appId) {
      return res.status(200).json({ agent_email: null, agent_phone: null, source: 'no-match' });
    }

    // 3. Fetch agent contact for this application
    const contactUrl = `${config.portal_base_url}/rest/v1/contacts`
      + `?application_id=${appId}&contact_type=agent&api_key=${config.tascomi_api_key}`;

    const cResp = await fetch(contactUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'PPM-Scanner/1.0' },
    });

    if (!cResp.ok) {
      return res.status(200).json({ agent_email: null, agent_phone: null, source: 'contact-error' });
    }

    const cData = await cResp.json();
    const agent = cData?.data?.[0];

    const agentName = agent
      ? [agent.first_name, agent.last_name].filter(Boolean).join(' ').trim() || null
      : null;

    return res.status(200).json({
      agent_email: agent?.email        || null,
      agent_phone: agent?.mobile       || agent?.telephone || null,
      agent_name:  agentName,
      source: 'idox-rest',
    });

  } catch (err) {
    return res.status(200).json({
      agent_email: null,
      agent_phone: null,
      source: 'error',
      error: err.message,
    });
  }
}
