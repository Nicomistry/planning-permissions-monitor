-- Shared lead report links (48-hour time-bomb links, admin-only creation)
CREATE TABLE IF NOT EXISTS shared_reports (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token       uuid        UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  created_by  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  leads_data  jsonb       NOT NULL DEFAULT '[]',
  label       text,                          -- optional title e.g. "Hounslow batch — March 2026"
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE shared_reports ENABLE ROW LEVEL SECURITY;

-- Admins can insert and read their own reports
DROP POLICY IF EXISTS "Admins insert shared reports"  ON shared_reports;
DROP POLICY IF EXISTS "Admins select shared reports"  ON shared_reports;
DROP POLICY IF EXISTS "Public read by token"          ON shared_reports;

CREATE POLICY "Admins insert shared reports"
  ON shared_reports FOR INSERT
  WITH CHECK ((SELECT is_admin FROM profiles WHERE user_id = auth.uid()) = true);

CREATE POLICY "Admins select shared reports"
  ON shared_reports FOR SELECT
  USING ((SELECT is_admin FROM profiles WHERE user_id = auth.uid()) = true);

-- Anyone can read a report by token (public share links)
CREATE POLICY "Public read by token"
  ON shared_reports FOR SELECT
  USING (true);
