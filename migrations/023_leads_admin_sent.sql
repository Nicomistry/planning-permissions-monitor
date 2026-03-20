-- Migration 023 — Admin-sent lead response tracking
-- Adds admin_sent flag and client_status to leads table

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS admin_sent BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS client_status TEXT DEFAULT NULL
    CHECK (client_status IN ('accepted', 'declined'));

-- Allow clients to update their own leads (needed for accept/decline)
-- Safe to run even if policy already exists
DROP POLICY IF EXISTS "Users update own leads" ON leads;
CREATE POLICY "Users update own leads"
  ON leads FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
