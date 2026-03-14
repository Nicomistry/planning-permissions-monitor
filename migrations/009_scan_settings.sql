-- Migration 009: Add scan_settings JSONB to profiles
-- Allows user's trade/council preferences to persist across devices.
-- Run once in Supabase SQL editor.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS scan_settings JSONB;
