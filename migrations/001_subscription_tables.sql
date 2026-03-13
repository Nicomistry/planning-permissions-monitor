-- ═══════════════════════════════════════════════════════════════════
-- Migration: 001_subscription_tables
-- Creates: plans, user_plans, user_councils
--
-- Purpose:
--   Implements Gap #2 from CLAUDE.md — user → council assignment.
--   Adds plan tiers, per-user subscription row, and per-user council
--   selection table. Fixes Issue 2: user_plans is read-only from
--   client side; all writes go through service role only.
--
-- NOTE: Admin policies in this file use a temporary hardcoded email
--   pattern. Migration 002 (profiles_table) MUST run after this to
--   replace all admin policies with profiles.is_admin checks.
--
-- Safe to re-run: uses CREATE TABLE IF NOT EXISTS, no DROP TABLE.
-- Run order: this file first, then 002_profiles_table.sql.
-- ═══════════════════════════════════════════════════════════════════

-- Rollback notes (manual):
--   DROP TABLE IF EXISTS user_councils;
--   DROP TABLE IF EXISTS user_plans;
--   DROP TABLE IF EXISTS plans;


-- ─── 1. plans ─────────────────────────────────────────────────────
-- Stores plan tiers. council_limit NULL = unlimited councils.
-- price_monthly stored in pence (e.g. 2900 = £29.00).

create table if not exists plans (
  id              uuid        primary key default gen_random_uuid(),
  name            text        not null,
  council_limit   int,                          -- NULL = unlimited
  price_monthly   int         not null,         -- pence
  created_at      timestamptz not null default now()
);

alter table plans enable row level security;

-- Temporary: replaced by profiles-based policy in 002_profiles_table.sql
drop policy if exists "Admin full access to plans" on plans;
create policy "Admin full access to plans"
  on plans for all
  using (
    (select email from auth.users where id = auth.uid()) = 'nicomistry@gmail.com'
  );

-- All authenticated users can read plan tiers (needed for upgrade flows)
drop policy if exists "Authenticated users can view plans" on plans;
create policy "Authenticated users can view plans"
  on plans for select
  using (auth.role() = 'authenticated');


-- ─── 2. user_plans ────────────────────────────────────────────────
-- One row per user. Tracks plan assignment, billing info, next scan.
-- Security: client gets SELECT only. All writes via service role
-- (Trigger.dev tasks, future Stripe webhook handler).
-- Broad update policy intentionally omitted — prevents client-side
-- tampering with status or stripe_subscription_id.

create table if not exists user_plans (
  id                       uuid        primary key default gen_random_uuid(),
  user_id                  uuid        not null references auth.users(id) on delete cascade,
  plan_id                  uuid        references plans(id),
  status                   text        not null default 'active',  -- active | cancelled | past_due | trialling
  billing_date             int,                                    -- day of month (1–28), nullable until billing confirmed
  next_scan_date           date,
  stripe_subscription_id   text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique(user_id)
);

create index if not exists user_plans_user_id_idx
  on user_plans(user_id);

-- Partial index: only active users need scheduled scanning
create index if not exists user_plans_next_scan_date_idx
  on user_plans(next_scan_date)
  where status = 'active';

alter table user_plans enable row level security;

-- Temporary: replaced by profiles-based policy in 002_profiles_table.sql
drop policy if exists "Admin full access to user_plans" on user_plans;
create policy "Admin full access to user_plans"
  on user_plans for all
  using (
    (select email from auth.users where id = auth.uid()) = 'nicomistry@gmail.com'
  );

-- SELECT only — no INSERT, UPDATE, DELETE from client side
drop policy if exists "Users can view own plan" on user_plans;
create policy "Users can view own plan"
  on user_plans for select
  using (auth.uid() = user_id);


-- ─── 3. user_councils ─────────────────────────────────────────────
-- Which councils each user has selected to monitor.
-- council_name is a soft reference to council_portal_configs.council_name
-- (no FK enforced — council_portal_configs is not fully populated yet).
-- region removed from original proposal — join to council_portal_configs
-- when region is needed to avoid data drift.

create table if not exists user_councils (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  council_name  text        not null,
  created_at    timestamptz not null default now(),
  unique(user_id, council_name)
);

create index if not exists user_councils_user_id_idx
  on user_councils(user_id);

alter table user_councils enable row level security;

-- Temporary: replaced by profiles-based policy in 002_profiles_table.sql
drop policy if exists "Admin full access to user_councils" on user_councils;
create policy "Admin full access to user_councils"
  on user_councils for all
  using (
    (select email from auth.users where id = auth.uid()) = 'nicomistry@gmail.com'
  );

drop policy if exists "Users can view own councils" on user_councils;
create policy "Users can view own councils"
  on user_councils for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own councils" on user_councils;
create policy "Users can insert own councils"
  on user_councils for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own councils" on user_councils;
create policy "Users can delete own councils"
  on user_councils for delete
  using (auth.uid() = user_id);
