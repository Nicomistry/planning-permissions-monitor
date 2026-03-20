-- Migration 023 — Admin-sent lead response tracking
-- Adds admin_sent flag and client_status to leads table

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS admin_sent BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS client_status TEXT DEFAULT NULL
    CHECK (client_status IN ('accepted', 'declined'));
