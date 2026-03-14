-- Migration 008: Clear all test data
-- Run this ONCE in Supabase SQL editor to wipe test leads and contacts.
-- Real leads from the live scraper will repopulate on next scan run.

-- Delete all leads (scraper will repopulate with real data on next run)
DELETE FROM leads;

-- Delete all contacts (test contacts saved during development)
DELETE FROM contacts;

-- Delete all control_panel_requests (test requests from development)
DELETE FROM control_panel_requests;

-- Reset all non-admin profiles back to clean state
-- (removes any leftover cp_runs_remaining from test grants)
UPDATE profiles
SET cp_runs_remaining = 0,
    cp_last_run_at    = NULL
WHERE is_admin = false;
