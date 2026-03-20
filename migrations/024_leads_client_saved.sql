-- Migration 024 — Client saved permissions
-- Lets clients bookmark any lead permanently

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS client_saved BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS leads_client_saved_idx ON leads (user_id, client_saved) WHERE client_saved = TRUE;
