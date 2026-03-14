-- ── Step 1: Extend profiles ───────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS cp_runs_remaining  int          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cp_last_run_at     timestamptz;

-- ── Step 2: Requests table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS control_panel_requests (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status        text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'granted', 'denied')),
  message       text,        -- user's optional message when requesting
  help_message  text,        -- user's message when using the help/exception button
  requested_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_at   timestamptz,
  reviewed_by   uuid        REFERENCES auth.users(id)
);

ALTER TABLE control_panel_requests ENABLE ROW LEVEL SECURITY;

-- Users: see & insert their own requests
DROP POLICY IF EXISTS "Users view own cp requests"   ON control_panel_requests;
DROP POLICY IF EXISTS "Users insert own cp requests" ON control_panel_requests;
DROP POLICY IF EXISTS "Users update own cp requests" ON control_panel_requests;
DROP POLICY IF EXISTS "Admins view all cp requests"  ON control_panel_requests;
DROP POLICY IF EXISTS "Admins update cp requests"    ON control_panel_requests;

CREATE POLICY "Users view own cp requests"
  ON control_panel_requests FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own cp requests"
  ON control_panel_requests FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own cp requests"
  ON control_panel_requests FOR UPDATE
  USING (user_id = auth.uid());

-- Admins: see & update all requests
CREATE POLICY "Admins view all cp requests"
  ON control_panel_requests FOR SELECT
  USING ((SELECT is_admin FROM profiles WHERE user_id = auth.uid()) = true);

CREATE POLICY "Admins update cp requests"
  ON control_panel_requests FOR UPDATE
  USING ((SELECT is_admin FROM profiles WHERE user_id = auth.uid()) = true);
