-- Migration 018 — Remove open shared_reports SELECT policy
-- USING(true) allowed any authenticated user to enumerate all shared reports.
-- Public report access is now handled by /api/get-report (service-role, validates token + expiry).

DROP POLICY IF EXISTS "Public read by token" ON shared_reports;
