-- ═══════════════════════════════════════════════════════════════════
-- Migration: 002_profiles_table
-- Creates: profiles (is_admin flag + auto-create trigger)
-- Rewrites: admin RLS policies on contacts, council_portal_configs,
--           plans, user_plans, user_councils
--
-- Purpose:
--   Replaces hardcoded nicomistry@gmail.com admin checks across all
--   five tables with a profiles.is_admin lookup. Makes admin access
--   role-based rather than email-based — any user can be promoted to
--   admin by setting is_admin = true, no code changes needed.
--
-- MUST run after 001_subscription_tables.sql.
-- Safe to re-run: IF NOT EXISTS, DROP POLICY IF EXISTS before recreate.
-- ═══════════════════════════════════════════════════════════════════

-- Rollback notes (manual):
--   DROP TABLE IF EXISTS profiles;
--   DROP FUNCTION IF EXISTS handle_new_user() CASCADE;
--   -- Then manually recreate old email-based policies on all 5 tables
--   -- using the pattern:
--   --   (select email from auth.users where id = auth.uid()) = 'nicomistry@gmail.com'


-- ─── 1. profiles ──────────────────────────────────────────────────
-- Mirrors auth.users — one row per user, created automatically on signup.
-- is_admin = false by default; set true manually per-user via service role.

create table if not exists profiles (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  is_admin    boolean     not null default false,
  created_at  timestamptz not null default now(),
  unique(user_id)
);

alter table profiles enable row level security;

-- Users can read their own profile (required for frontend is_admin check)
create policy "Users can view own profile"
  on profiles for select
  using (auth.uid() = user_id);

-- No client-side writes — all profile management via service role only


-- ─── 2. Auto-create profile on signup ─────────────────────────────
-- Fires after every new row in auth.users.
-- on conflict do nothing = safe to re-run if trigger fires twice.

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id, is_admin)
  values (new.id, false)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();


-- ─── 3. Seed existing admin user ──────────────────────────────────
-- Sets is_admin = true for the existing admin account.
-- Safe to re-run (upsert on conflict).

insert into profiles (user_id, is_admin)
values ('562106be-fb59-4f84-b1d5-e60b87b8bb35', true)
on conflict (user_id) do update set is_admin = true;


-- ─── 4. Rewrite admin RLS policies (all 5 tables) ─────────────────
-- For each table: drop the old email-based policy, add the new
-- profiles-based one with the same policy name.
-- "Authenticated users can view" policies are NOT touched.


-- contacts
drop policy if exists "Admin full access to contacts" on contacts;
create policy "Admin full access to contacts"
  on contacts for all
  using (
    (select is_admin from profiles where user_id = auth.uid()) = true
  );

-- council_portal_configs
drop policy if exists "Admin full access to council configs" on council_portal_configs;
create policy "Admin full access to council configs"
  on council_portal_configs for all
  using (
    (select is_admin from profiles where user_id = auth.uid()) = true
  );

-- plans (created in 001)
drop policy if exists "Admin full access to plans" on plans;
create policy "Admin full access to plans"
  on plans for all
  using (
    (select is_admin from profiles where user_id = auth.uid()) = true
  );

-- user_plans (created in 001)
drop policy if exists "Admin full access to user_plans" on user_plans;
create policy "Admin full access to user_plans"
  on user_plans for all
  using (
    (select is_admin from profiles where user_id = auth.uid()) = true
  );

-- user_councils (created in 001)
drop policy if exists "Admin full access to user_councils" on user_councils;
create policy "Admin full access to user_councils"
  on user_councils for all
  using (
    (select is_admin from profiles where user_id = auth.uid()) = true
  );
