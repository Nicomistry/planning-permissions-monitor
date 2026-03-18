-- Migration 022 — Stripe billing setup
-- Adds stripe_customer_id to profiles and seeds plan tiers.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

-- Ensure name is unique so ON CONFLICT works
CREATE UNIQUE INDEX IF NOT EXISTS plans_name_unique ON plans(name);

-- Seed plan tiers (safe to re-run)
INSERT INTO plans (name, council_limit, price_monthly)
VALUES
  ('Starter',   3,    14900),
  ('Pro',       20,   34900),
  ('Unlimited', NULL, 70000)
ON CONFLICT (name) DO UPDATE
  SET council_limit  = EXCLUDED.council_limit,
      price_monthly  = EXCLUDED.price_monthly;
