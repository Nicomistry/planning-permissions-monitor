-- Migration 012: client_conversations table
-- Stores every PPM Assistant conversation turn for paying clients.
-- Separate from prospect_conversations (which logs pre-signup demo chats).
-- Run once in Supabase SQL editor.

-- ── Table ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_conversations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  messages     jsonb       NOT NULL DEFAULT '[]',
  context_used jsonb                  DEFAULT '[]',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- context_used: array of market_intelligence row IDs injected into the AI
-- context for this session. Allows admin to audit exactly what data the AI used.

-- ── updated_at trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_client_conversations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_client_conversations_updated_at ON client_conversations;
CREATE TRIGGER trg_client_conversations_updated_at
  BEFORE UPDATE ON client_conversations
  FOR EACH ROW EXECUTE FUNCTION update_client_conversations_updated_at();

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_client_conversations_user_id    ON client_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_client_conversations_updated_at ON client_conversations(updated_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE client_conversations ENABLE ROW LEVEL SECURITY;

-- Admins: full access
DROP POLICY IF EXISTS "Admins full access client_conversations" ON client_conversations;
CREATE POLICY "Admins full access client_conversations"
  ON client_conversations FOR ALL
  USING ((SELECT is_admin FROM profiles WHERE user_id = auth.uid()) = true);

-- Users: read own row
DROP POLICY IF EXISTS "Users read own conversation" ON client_conversations;
CREATE POLICY "Users read own conversation"
  ON client_conversations FOR SELECT
  USING (auth.uid() = user_id);

-- Users: update own row (append messages)
DROP POLICY IF EXISTS "Users update own conversation" ON client_conversations;
CREATE POLICY "Users update own conversation"
  ON client_conversations FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- No client INSERT or DELETE — server side only via service role
