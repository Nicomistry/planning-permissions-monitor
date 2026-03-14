import { task, logger } from "@trigger.dev/sdk/v3";
import { createClient } from "@supabase/supabase-js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlanItRecord {
  uid: string;
  address: string;
  postcode: string;
  description: string;
  app_type: string;
  app_state: string;
  app_size?: string;
  start_date: string;
  url?: string;
  link?: string;
  area_name?: string;
  applicant_name?: string;
  applicant_address?: string;
  agent_name?: string;
  agent_address?: string;
  other_fields?: {
    target_decision_date?: string;
    url?: string;
    [key: string]: unknown;
  };
}

interface Enrichment {
  uid: string;
  unit_count: number | null;
  dwelling_type: "house" | "flat" | "bungalow" | "mixed" | "unknown";
  development_scale: "single" | "small" | "medium" | "large" | "unknown";
  applicant_type: "individual" | "developer" | "housing_association" | "council" | "unknown";
  notes: string;
}

interface Score {
  uid: string;
  score: number;
  priority: "HIGH" | "MEDIUM" | "LOW";
  reasoning: string;
}

export interface MergedLead {
  uid: string;
  reference: string;
  council: string;
  address: string;
  postcode: string;
  description: string;
  app_type: string;
  app_state: string;
  app_size: string | null;
  start_date: string;
  target_decision_date: string | null;
  applicant_name: string | null;
  applicant_address: string | null;
  agent_name: string | null;
  agent_address: string | null;
  planit_url: string | null;
  council_url: string | null;
  scraped_date: string;
  unit_count: number | null;
  dwelling_type: string;
  development_scale: string;
  applicant_type: string;
  enrichment_notes: string;
  opportunity_score: number;
  priority: "HIGH" | "MEDIUM" | "LOW";
  score_reasoning: string;
}

// ─── Keyword filter (mirrors n8n Code Filter Stage) ───────────────────────────

// Mix of plain strings (phrase match) and RegExp (word-boundary match).
// RegExp used where plain-string matching causes false negatives on real leads.
const EXCLUDE_DESC: (string | RegExp)[] = [
  "rear extension", "side extension", "front extension",
  "single storey extension", "two storey extension", "double storey extension",
  "loft conversion", "dormer", "hip to gable",
  "porch", "conservatory", "orangery",
  "garage conversion",
  "internal alterations", "internal works",
  "roof alterations", "roof lights", "velux",
  "discharge of condition", "non material amendment",
  "prior approval", "lawful development certificate",
  "listed building consent",
  "commercial", "industrial", "retail",
  /(?<!home )\boffice\b/,          // was "office" — excludes "office" but not "home office"
  "telecommunications", "advertisement",
  /\bsign\b/,                      // was "signage" — avoids false match on "design"/"designation"
  /\bwaste\b(?!water)/,            // new — avoids false match on "wastewater drainage"
  "tree works", "tree preservation", "hedgerow",
  "replacement windows", "replacement doors",
];

const EXCLUDE_APP_TYPES = [
  "conditions", "trees", "advert", "prior", "ldc", "listed", "heritage",
];

const INCLUDE_KEYWORDS = [
  "new dwelling", "new dwellings",
  "new house", "new houses", "new home", "new homes",
  "replacement dwelling", "replacement house",
  "new build", "newbuild",
  "erection of",
  "residential development", "residential units", "new residential",
  "demolition and erection",
  "barn conversion",
  "change of use to dwelling", "change of use to residential",
  "conversion to",
  "subdivision",
  "self build", "self-build", "custom build",
  "affordable housing",
  "mixed use",
];

function matchesKeyword(text: string, kw: string | RegExp): boolean {
  return typeof kw === "string" ? text.includes(kw) : kw.test(text);
}

function keywordFilter(records: PlanItRecord[]): PlanItRecord[] {
  return records.filter((app) => {
    const desc = (app.description || "").toLowerCase();
    const appType = (app.app_type || "").toLowerCase();
    const appState = (app.app_state || "").toLowerCase();

    if (appState === "decided" || appState === "withdrawn") return false;
    if (EXCLUDE_APP_TYPES.some((t) => appType.includes(t))) return false;
    if (EXCLUDE_DESC.some((kw) => matchesKeyword(desc, kw))) return false;
    if (!INCLUDE_KEYWORDS.some((kw) => matchesKeyword(desc, kw))) return false;

    return true;
  });
}

// ─── OpenRouter helper ────────────────────────────────────────────────────────

async function callOpenRouter(systemPrompt: string, userContent: string): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "anthropic/claude-3.5-haiku",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0].message.content;
}

// ─── Fetch with retry/backoff ─────────────────────────────────────────────────

async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  maxRetries = 3,
): Promise<Response> {
  const BACKOFF_MS = [2000, 4000, 8000];

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const res = await fetch(url, options);
    if (res.ok) return res;

    const isRetryable = res.status === 429 || res.status >= 500;

    if (!isRetryable) {
      throw new Error(`Fetch failed with non-retryable status ${res.status}: ${url}`);
    }

    if (attempt > maxRetries) {
      throw new Error(`Fetch failed after ${maxRetries} retries, last status ${res.status}: ${url}`);
    }

    let waitMs = BACKOFF_MS[attempt - 1];
    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      if (retryAfter) {
        const seconds = parseInt(retryAfter, 10);
        if (!isNaN(seconds)) waitMs = seconds * 1000;
      }
    }

    logger.info(
      `Planit fetch attempt ${attempt}/${maxRetries + 1} failed (${res.status}) — retrying in ${waitMs / 1000}s`,
    );
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  // Unreachable — loop always returns or throws above
  throw new Error("fetchWithRetry: unexpected exit");
}

// Parse a JSON array out of an AI response (handles markdown code fences)
function parseJsonArray<T>(raw: string): T[] {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    return JSON.parse(match[0]) as T[];
  } catch {
    return [];
  }
}

// ─── Task ─────────────────────────────────────────────────────────────────────

export const processCouncilTask = task({
  id: "process-council",
  maxDuration: 300, // 5 minutes per council

  run: async (payload: { council_name: string; council_auth: string; userId?: string }) => {
    const { council_name, council_auth, userId } = payload;
    logger.info(`▶ Processing council: ${council_name}`);

    // 1. Fetch from planit.org.uk
    const params = new URLSearchParams({
      auth: council_auth,
      recent: "30",
      pg_sz: "200",
      app_state: "Undecided",
      search: 'dwelling or "new house" or "new homes" or "new build" or "replacement dwelling" or "residential development"',
      compress: "on",
    });

    const apiRes = await fetchWithRetry(
      `https://www.planit.org.uk/api/applics/json?${params.toString()}`,
    );
    const data = (await apiRes.json()) as { records?: PlanItRecord[] };
    const records = data.records ?? [];
    logger.info(`${council_name}: ${records.length} raw records`);

    // 2. Keyword filter
    const filtered = keywordFilter(records);
    logger.info(`${council_name}: ${filtered.length} after keyword filter`);
    if (filtered.length === 0) return { leads: [] as MergedLead[] };

    // 3. AI batch classify — returns array of UIDs to keep
    const classifyInput = filtered.map((app) => ({
      uid: app.uid,
      address: app.address,
      description: app.description,
      app_type: app.app_type,
    }));

    const classifyRaw = await callOpenRouter(
      `You are a lead qualification specialist for a new home builder in South East England.
Review planning applications and return ONLY the UIDs of genuine new-build residential opportunities.

KEEP: new dwellings, apartment blocks, replacement dwellings, barn/building conversions creating new residential units, self-build plots, affordable housing, mixed-use with significant residential element.
REJECT: extensions, loft conversions, garage conversions, commercial/retail/office only, householder applications, prior approval notifications, infrastructure.

This client builds NEW HOMES. They are NOT interested in refurbishment or extension work.
Return ONLY a JSON array of UID strings. No explanation. No markdown.
Example: ["SB/2024/0123","TR/2024/0456"]`,
      JSON.stringify(classifyInput)
    );

    const qualifiedUIDs = parseJsonArray<string>(classifyRaw);
    logger.info(`${council_name}: ${qualifiedUIDs.length} after AI classify`);
    if (qualifiedUIDs.length === 0) return { leads: [] as MergedLead[] };

    // 4. Restore full records for qualified UIDs
    const qualified = records.filter((app) => qualifiedUIDs.includes(app.uid));

    // 5. AI batch enrich
    const enrichInput = qualified.map((app) => ({
      uid: app.uid,
      description: app.description,
      applicant_name: app.applicant_name ?? null,
      agent_name: app.agent_name ?? null,
    }));

    const enrichRaw = await callOpenRouter(
      `You are a planning application data extractor.
Extract structured data from each application and return a JSON array.
Each object must have exactly these fields:
{
  "uid": "<uid>",
  "unit_count": <number or null>,
  "dwelling_type": "<house|flat|bungalow|mixed|unknown>",
  "development_scale": "<single|small|medium|large|unknown>",
  "applicant_type": "<individual|developer|housing_association|council|unknown>",
  "notes": "<one key detail about this development>"
}
Scale guide: single=1 unit, small=2-5, medium=6-20, large=21+.
Return ONLY a valid JSON array. No markdown. No explanation.`,
      JSON.stringify(enrichInput)
    );

    const enrichments = parseJsonArray<Enrichment>(enrichRaw);
    const enrichMap = new Map(enrichments.map((e) => [e.uid, e]));

    // 6. AI batch score
    const scoreInput = qualified.map((app) => {
      const enrich = enrichMap.get(app.uid);
      return {
        uid: app.uid,
        description: app.description,
        postcode: app.postcode,
        unit_count: enrich?.unit_count ?? null,
        development_scale: enrich?.development_scale ?? "unknown",
        applicant_type: enrich?.applicant_type ?? "unknown",
      };
    });

    const scoreRaw = await callOpenRouter(
      `You are a property development opportunity scorer for South East England.
Score each planning application as a lead for a property developer.
Return a JSON array where each object has exactly these fields:
{
  "uid": "<uid>",
  "score": <integer 1-10>,
  "priority": "<HIGH|MEDIUM|LOW>",
  "reasoning": "<one sentence>"
}
Scoring guide:
- 9-10 HIGH: Large scheme 6+ units or major redevelopment
- 7-8 HIGH: Medium scheme 3-5 units or premium single dwelling
- 5-6 MEDIUM: Standard 1-2 unit development
- 3-4 LOW: Simple replacement dwelling or minor infill
- 1-2 LOW: Minimal opportunity
Consider: unit count, development scale, postcode desirability, applicant type (developer > individual).
Return ONLY a valid JSON array. No markdown. No explanation.`,
      JSON.stringify(scoreInput)
    );

    const scores = parseJsonArray<Score>(scoreRaw);
    const scoreMap = new Map(scores.map((s) => [s.uid, s]));

    // 7. Merge everything
    const today = new Date().toISOString().split("T")[0];
    const leads: MergedLead[] = qualified.map((app) => {
      const enrich = enrichMap.get(app.uid);
      const score = scoreMap.get(app.uid);
      return {
        uid: app.uid,
        reference: app.uid,
        council: app.area_name ?? council_name,
        address: app.address,
        postcode: app.postcode,
        description: app.description,
        app_type: app.app_type,
        app_state: app.app_state,
        app_size: app.app_size ?? null,
        start_date: app.start_date,
        target_decision_date: app.other_fields?.target_decision_date ?? null,
        applicant_name: app.applicant_name ?? null,
        applicant_address: app.applicant_address ?? null,
        agent_name: app.agent_name ?? null,
        agent_address: app.agent_address ?? null,
        planit_url: app.link ?? app.url ?? null,
        council_url: app.other_fields?.url ?? null,
        scraped_date: today,
        unit_count: enrich?.unit_count ?? null,
        dwelling_type: enrich?.dwelling_type ?? "unknown",
        development_scale: enrich?.development_scale ?? "unknown",
        applicant_type: enrich?.applicant_type ?? "unknown",
        enrichment_notes: enrich?.notes ?? "",
        opportunity_score: score?.score ?? 0,
        priority: score?.priority ?? "LOW",
        score_reasoning: score?.reasoning ?? "",
      };
    });

    logger.info(`${council_name}: ✓ ${leads.length} enriched leads`);

    // ── Supabase upsert ───────────────────────────────────────────────────────
    // TODO: Replace ADMIN_USER_ID with per-user fan-out once the user→council
    // preferences table is built (Gap #2). Every lead currently goes to one
    // fallback user only.
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const resolvedUserId = userId ?? process.env.ADMIN_USER_ID;

    const rows = leads.map((lead) => ({
      user_id:              resolvedUserId,
      uid:                  lead.uid,
      council:              lead.council,
      address:              lead.address,
      postcode:             lead.postcode,
      description:          lead.description,
      app_type:             lead.app_type,
      app_state:            lead.app_state,
      start_date:           lead.start_date,
      target_decision_date: lead.target_decision_date,
      applicant_name:       lead.applicant_name,
      agent_name:           lead.agent_name,
      planit_url:           lead.planit_url,
      opportunity_score:    lead.opportunity_score,
      priority:             lead.priority,
      score_reasoning:      lead.score_reasoning,
      dwelling_type:        lead.dwelling_type,
      development_scale:    lead.development_scale,
      unit_count:           lead.unit_count,
      scraped_date:         today,
    }));

    const { data: upserted, error: upsertError } = await supabase
      .from("leads")
      .upsert(rows, { onConflict: "user_id,uid", ignoreDuplicates: true })
      .select("id");

    if (upsertError) {
      logger.error(`${council_name}: upsert failed`, { error: upsertError.message });
    } else {
      logger.info(`${council_name}: upserted ${upserted?.length ?? 0} leads into Supabase (new or updated)`);
    }
    // ─────────────────────────────────────────────────────────────────────────

    return { leads };
  },
});
