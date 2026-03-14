-- Migration 015: assistant permissions
-- Controls which paying clients can access PPM Assistant.
-- Separate from cp_runs_remaining (scan credits) — assistant is a distinct gate.
-- Run once in Supabase SQL editor.

-- ── Extend profiles table ─────────────────────────────────────────────────────
-- assistant_enabled: false by default — admin must explicitly grant access
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS assistant_enabled     boolean     NOT NULL DEFAULT false;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS assistant_granted_at  timestamptz;

-- ── assistant_requests table ──────────────────────────────────────────────────
-- Clients can request access; admin reviews and grants/denies.
CREATE TABLE IF NOT EXISTS assistant_requests (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status      text        NOT NULL DEFAULT 'pending',
  message     text,
  reviewed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- status values:
--   'pending'  — request submitted, not yet reviewed
--   'granted'  — admin approved, assistant_enabled set to true on profiles
--   'denied'   — admin declined

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_assistant_requests_user_id ON assistant_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_assistant_requests_status  ON assistant_requests(status);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE assistant_requests ENABLE ROW LEVEL SECURITY;

-- Admins: full access
DROP POLICY IF EXISTS "Admins full access assistant_requests" ON assistant_requests;
CREATE POLICY "Admins full access assistant_requests"
  ON assistant_requests FOR ALL
  USING ((SELECT is_admin FROM profiles WHERE user_id = auth.uid()) = true);

-- Users: insert own request
DROP POLICY IF EXISTS "Users insert own assistant request" ON assistant_requests;
CREATE POLICY "Users insert own assistant request"
  ON assistant_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users: read own request (so they can see their status)
DROP POLICY IF EXISTS "Users read own assistant request" ON assistant_requests;
CREATE POLICY "Users read own assistant request"
  ON assistant_requests FOR SELECT
  USING (auth.uid() = user_id);

-- No client UPDATE or DELETE
