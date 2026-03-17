-- Migration 020 — DB integrity fixes + performance indexes

-- ── H3: contacts.user_id must not be nullable ─────────────────────────────
-- Orphaned rows (user_id IS NULL) are invisible to RLS and can't be deleted.
-- First remove any existing orphans, then enforce NOT NULL.
DELETE FROM contacts WHERE user_id IS NULL;
ALTER TABLE contacts ALTER COLUMN user_id SET NOT NULL;

-- ── H4: Performance indexes ────────────────────────────────────────────────
-- leads: most queries filter by user_id, then council/state/score
CREATE INDEX IF NOT EXISTS leads_user_id_idx       ON leads (user_id);
CREATE INDEX IF NOT EXISTS leads_council_idx        ON leads (council);
CREATE INDEX IF NOT EXISTS leads_state_idx          ON leads (state);
CREATE INDEX IF NOT EXISTS leads_score_idx          ON leads (opportunity_score DESC);

-- contacts: all RLS policies and queries filter by user_id
CREATE INDEX IF NOT EXISTS contacts_user_id_idx     ON contacts (user_id);

-- shared_reports: admin queries filter by created_by; expiry cleanup needs expires_at
CREATE INDEX IF NOT EXISTS shared_reports_creator_idx  ON shared_reports (created_by);
CREATE INDEX IF NOT EXISTS shared_reports_expires_idx  ON shared_reports (expires_at);
