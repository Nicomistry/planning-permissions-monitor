-- Migration 007: Make contacts per-user
-- Adds user_id to contacts, drops shared-view policy, adds per-user policies

-- Add user_id column (nullable first so existing rows don't break)
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Drop the old shared "all subscribers can view" policy
DROP POLICY IF EXISTS "Authenticated users can view contacts" ON contacts;

-- Users can only see / manage their own contacts
DROP POLICY IF EXISTS "Users manage own contacts" ON contacts;
CREATE POLICY "Users manage own contacts"
  ON contacts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
