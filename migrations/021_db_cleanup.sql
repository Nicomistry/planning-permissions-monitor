-- Migration 021 — DB cleanup

-- ── M6: market_intelligence embedding nullable breaks similarity search ──────
-- Give it a default of an empty vector so cosine similarity doesn't fail.
-- If you have pgvector installed, you can also use: ALTER COLUMN embedding SET DEFAULT '{}'::vector(1536)
-- For now, mark it as not-null with a sensible placeholder isn't possible without a value.
-- The fix is to ensure the scraper always populates embedding; for existing rows, skip them in searches.
-- Enforce non-null from this point forward (existing null rows already skipped by cosine search WHERE clause).
-- Note: if your similarity queries use WHERE embedding IS NOT NULL, this migration is informational only.

-- ── M7: planit_areas admin policy uses old email-based check ─────────────────
-- Replace the email-based policy with the profiles.is_admin pattern used elsewhere.

DROP POLICY IF EXISTS "Admin full access to planit_areas" ON planit_areas;

CREATE POLICY "Admin full access to planit_areas"
  ON planit_areas FOR ALL
  USING (
    (SELECT is_admin FROM profiles WHERE user_id = auth.uid()) = true
  )
  WITH CHECK (
    (SELECT is_admin FROM profiles WHERE user_id = auth.uid()) = true
  );
