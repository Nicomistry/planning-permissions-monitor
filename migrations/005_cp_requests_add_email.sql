ALTER TABLE control_panel_requests
  ADD COLUMN IF NOT EXISTS user_email text;
