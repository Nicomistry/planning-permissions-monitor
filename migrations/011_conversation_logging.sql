-- Migration 011: conversation logging tables
-- prospect_conversations: logs every prospect agent chat turn (service role writes only)
-- intelligence_searches:  logs PPM Intelligence search terms per paying client
-- Run once in Supabase SQL editor.

-- ══════════════════════════════════════════════════════════════════════════════
-- TABLE 1 — prospect_conversations
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS prospect_conversations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_email  text        NOT NULL,
  prospect_name   text,
  trade           text,
  area            text,
  messages        jsonb       NOT NULL DEFAULT '[]',
  report_sent     boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- updated_at auto-trigger
CREATE OR REPLACE FUNCTION update_prospect_conversations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prospect_conversations_updated_at ON prospect_conversations;
CREATE TRIGGER trg_prospect_conversations_updated_at
  BEFORE UPDATE ON prospect_conversations
  FOR EACH ROW EXECUTE FUNCTION update_prospect_conversations_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_prospect_conversations_email      ON prospect_conversations(prospect_email);
CREATE INDEX IF NOT EXISTS idx_prospect_conversations_created_at ON prospect_conversations(created_at DESC);

-- RLS — admin only (service role bypasses RLS for writes)
ALTER TABLE prospect_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access prospect_conversations" ON prospect_conversations;
CREATE POLICY "Admins full access prospect_conversations"
  ON prospect_conversations FOR ALL
  USING ((SELECT is_admin FROM profiles WHERE user_id = auth.uid()) = true);

-- ══════════════════════════════════════════════════════════════════════════════
-- TABLE 2 — intelligence_searches
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS intelligence_searches (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  search_term text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_intelligence_searches_user_id    ON intelligence_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_intelligence_searches_created_at ON intelligence_searches(created_at DESC);

-- RLS
ALTER TABLE intelligence_searches ENABLE ROW LEVEL SECURITY;

-- Admins: full access
DROP POLICY IF EXISTS "Admins full access intelligence_searches" ON intelligence_searches;
CREATE POLICY "Admins full access intelligence_searches"
  ON intelligence_searches FOR ALL
  USING ((SELECT is_admin FROM profiles WHERE user_id = auth.uid()) = true);

-- Users: insert own rows only (no SELECT back)
DROP POLICY IF EXISTS "Users insert own searches" ON intelligence_searches;
CREATE POLICY "Users insert own searches"
  ON intelligence_searches FOR INSERT
  WITH CHECK (auth.uid() = user_id);
