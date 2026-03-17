-- Migration 019 — Add AI call rate-limit counters to profiles
-- Tracks daily OpenRouter calls per user to prevent runaway spend.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS ai_calls_today integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_calls_date  date;
