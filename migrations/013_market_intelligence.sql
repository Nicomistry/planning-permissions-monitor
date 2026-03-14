-- Migration 013: market_intelligence table
-- Stores scraped industry data, pricing benchmarks, and learned knowledge
-- from client interactions. Powers the AI's agentic context injection.
--
-- ⚠ PREREQUISITE: Run this first if pgvector is not already enabled:
--   CREATE EXTENSION IF NOT EXISTS vector;
--
-- Run once in Supabase SQL editor.

-- ── Table ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_intelligence (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  category     text        NOT NULL,
  title        text        NOT NULL,
  content      text        NOT NULL,
  source_url   text,
  source_name  text,
  trade_tags   text[]      DEFAULT '{}',
  region_tags  text[]      DEFAULT '{}',
  embedding    vector(1536),
  confidence   float       DEFAULT 1.0,
  learned_from text        DEFAULT 'manual',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- category values:
--   'pricing'        — contract value benchmarks, labour rates
--   'market_news'    — industry news articles
--   'regulations'    — planning rules, building regs updates
--   'planning_stats' — aggregated planning application statistics
--   'learned'        — questions asked by clients, topics to research
--   'scraped'        — auto-ingested from configured sources

-- learned_from values:
--   'manual'               — entered by admin (confidence 1.0)
--   'scraper'              — auto-scraped from source URLs (confidence 0.8)
--   'client_interaction'   — logged from client questions (confidence 0.3–0.6)
--   'admin'                — edited/verified by admin (confidence 1.0)

-- confidence: 0.0–1.0
--   1.0 = manually verified by admin
--   0.8 = scraped from trusted source
--   0.6 = inferred from client interaction, needs verification
--   0.3 = unanswered client question, no data yet

-- ── updated_at trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_market_intelligence_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_market_intelligence_updated_at ON market_intelligence;
CREATE TRIGGER trg_market_intelligence_updated_at
  BEFORE UPDATE ON market_intelligence
  FOR EACH ROW EXECUTE FUNCTION update_market_intelligence_updated_at();

-- ── Indexes ───────────────────────────────────────────────────────────────────
-- Vector similarity search (cosine) — requires pgvector extension
CREATE INDEX IF NOT EXISTS idx_market_intelligence_embedding
  ON market_intelligence
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_market_intelligence_category
  ON market_intelligence(category);

CREATE INDEX IF NOT EXISTS idx_market_intelligence_trade_tags
  ON market_intelligence USING GIN(trade_tags);

CREATE INDEX IF NOT EXISTS idx_market_intelligence_region_tags
  ON market_intelligence USING GIN(region_tags);

CREATE INDEX IF NOT EXISTS idx_market_intelligence_confidence
  ON market_intelligence(confidence DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE market_intelligence ENABLE ROW LEVEL SECURITY;

-- Admins: full access
DROP POLICY IF EXISTS "Admins full access market_intelligence" ON market_intelligence;
CREATE POLICY "Admins full access market_intelligence"
  ON market_intelligence FOR ALL
  USING ((SELECT is_admin FROM profiles WHERE user_id = auth.uid()) = true);

-- Authenticated users: read only
-- Clients can read intelligence injected into AI context — cannot write
DROP POLICY IF EXISTS "Authenticated users read market_intelligence" ON market_intelligence;
CREATE POLICY "Authenticated users read market_intelligence"
  ON market_intelligence FOR SELECT
  USING (auth.role() = 'authenticated');
