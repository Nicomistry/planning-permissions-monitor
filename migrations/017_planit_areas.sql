-- ═══════════════════════════════════════════════════════════════════
-- Migration 017 — PlanIt Areas registry
-- Stores all 417 active UK planning authorities from planit.org.uk
-- Seeded via /api/sync-councils (admin-only, call once from admin panel)
-- ═══════════════════════════════════════════════════════════════════

create table if not exists planit_areas (
  area_id    integer primary key,          -- PlanIt numeric auth ID (use in API calls)
  area_name  text    not null unique,       -- PlanIt canonical name  (e.g. "Hackney")
  area_type  text,                          -- "London Borough" | "English District" | etc.
  synced_at  timestamptz not null default now()
);

-- Index for fast name lookup during scans
create index if not exists planit_areas_name_idx
  on planit_areas (lower(area_name));

-- Only admin can manage this table
alter table planit_areas enable row level security;

create policy "Admin full access to planit_areas"
  on planit_areas for all
  using (
    (select email from auth.users where id = auth.uid()) = 'nicomistry@gmail.com'
  );

-- All authenticated users can read (needed to populate council picker)
create policy "Authenticated users can read planit_areas"
  on planit_areas for select
  using (auth.role() = 'authenticated');
