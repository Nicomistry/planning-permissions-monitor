-- Migration 014: ai_config table
-- Admin-configurable AI behaviour settings.
-- Changes take effect on next AI request — no redeploy needed.
-- Run once in Supabase SQL editor.

-- ── Table ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_config (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key   text        NOT NULL UNIQUE,
  config_value text        NOT NULL,
  description  text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ── updated_at trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_ai_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_config_updated_at ON ai_config;
CREATE TRIGGER trg_ai_config_updated_at
  BEFORE UPDATE ON ai_config
  FOR EACH ROW EXECUTE FUNCTION update_ai_config_updated_at();

-- ── Seed default config ───────────────────────────────────────────────────────
-- ON CONFLICT DO NOTHING — safe to re-run, will not overwrite admin edits
INSERT INTO ai_config (config_key, config_value, description) VALUES
  ('assistant_name',
   'PPM Assistant',
   'What the AI calls itself in all responses'),

  ('tone',
   'warm, professional, construction-industry',
   'Tone of voice applied to all AI responses'),

  ('forbidden_topics',
   'competitors, politics, religion',
   'Comma-separated topics the AI must never discuss'),

  ('prospect_pitch_style',
   'tease_not_reveal',
   'How the prospect agent handles lead data: tease stats, never reveal addresses'),

  ('max_leads_in_context',
   '50',
   'Maximum number of lead records injected into each AI request'),

  ('learning_enabled',
   'true',
   'Whether the AI logs unanswered client questions to market_intelligence'),

  ('scraper_sources',
   'fmb.org.uk,nhbc.co.uk,theconstructionindex.co.uk',
   'Comma-separated domains for the weekly market intelligence scraper')

ON CONFLICT (config_key) DO NOTHING;

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE ai_config ENABLE ROW LEVEL SECURITY;

-- Admins: full access
DROP POLICY IF EXISTS "Admins full access ai_config" ON ai_config;
CREATE POLICY "Admins full access ai_config"
  ON ai_config FOR ALL
  USING ((SELECT is_admin FROM profiles WHERE user_id = auth.uid()) = true);

-- Authenticated users: read only
-- AI engine reads config server-side via service role; clients read for display only
DROP POLICY IF EXISTS "Authenticated users read ai_config" ON ai_config;
CREATE POLICY "Authenticated users read ai_config"
  ON ai_config FOR SELECT
  USING (auth.role() = 'authenticated');
