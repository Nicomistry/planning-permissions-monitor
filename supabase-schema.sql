-- ═══════════════════════════════════════════════════════════════════
-- PPM — Supabase Schema
-- Run this in your Supabase project: SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════════

-- 1. Demo requests (from the Book A Demo form)
create table if not exists demo_requests (
  id          uuid primary key default gen_random_uuid(),
  first_name  text not null,
  last_name   text not null,
  email       text not null,
  phone       text not null,
  trade       text not null,
  status      text not null default 'new',   -- new | contacted | converted | closed
  notes       text,
  created_at  timestamptz not null default now()
);

-- 2. Leads (planning applications scraped per customer)
create table if not exists leads (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid references auth.users(id) on delete cascade,
  uid                  text not null,          -- PlanIt UID e.g. "SB/2024/0123"
  council              text,
  address              text,
  postcode             text,
  description          text,
  app_type             text,
  app_state            text,
  start_date           text,
  target_decision_date text,
  applicant_name       text,
  agent_name           text,
  planit_url           text,
  opportunity_score    int,
  priority             text,                   -- HIGH | MEDIUM | LOW
  score_reasoning      text,
  dwelling_type        text,
  development_scale    text,
  unit_count           int,
  scraped_date         date,
  created_at           timestamptz not null default now(),
  unique(user_id, uid)                         -- prevent duplicate leads per user
);

-- 3. Row Level Security — users can only see their own leads
alter table leads enable row level security;

create policy "Users see own leads"
  on leads for select
  using (auth.uid() = user_id);

-- Demo requests: only service role can read (you manage these in Supabase dashboard)
alter table demo_requests enable row level security;

create policy "Anyone can insert demo request"
  on demo_requests for insert
  with check (true);

-- 4. Contacts (leads saved by admin, visible to all subscribers)
create table if not exists contacts (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  name         text,
  phone        text,
  email        text,
  address      text,
  council      text,
  app_type     text,
  priority     text,           -- HIGH | MEDIUM | LOW
  score        int,
  status       text not null default 'new',  -- new | contacted | converted | closed
  notes        text
);

alter table contacts enable row level security;

-- Admin can do everything
create policy "Admin full access to contacts"
  on contacts for all
  using (
    (select email from auth.users where id = auth.uid()) = 'nicomistry@gmail.com'
  );

-- All authenticated users can view contacts
create policy "Authenticated users can view contacts"
  on contacts for select
  using (auth.role() = 'authenticated');

-- ═══════════════════════════════════════════════════════════════════
-- 5. Council Portal Registry (pgvector)
--    Run: Extensions → enable "vector" first in Supabase dashboard
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists vector;

create table if not exists council_portal_configs (
  id               uuid primary key default gen_random_uuid(),
  council_name     text not null unique,   -- matches ALL_COUNCILS in admin.html
  region           text,                   -- London | South East | Midlands | etc.

  -- Portal software (detected from planning.data.gov.uk + URL patterns)
  software_type    text,                   -- Idox | Northgate | Ocella | Agile | Other
  portal_base_url  text,                   -- e.g. https://hackney-planning.tascomi.com
  tascomi_api_key  text,                   -- Idox REST API key (per-council, register with Idox)

  -- Verified capability flags (updated as councils are tested)
  has_rest_api       boolean default false,
  has_agent_email    boolean default false,
  has_agent_phone    boolean default false,
  notes              text,

  -- Vector embedding of capability profile for similarity search
  -- Embed: "{council_name} {software_type} {region} agent_email:{has_agent_email}"
  capability_embedding vector(1536),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- IVFFlat index for cosine similarity queries
create index if not exists council_portal_configs_embedding_idx
  on council_portal_configs
  using ivfflat (capability_embedding vector_cosine_ops)
  with (lists = 50);

alter table council_portal_configs enable row level security;

create policy "Admin full access to council configs"
  on council_portal_configs for all
  using (
    (select email from auth.users where id = auth.uid()) = 'nicomistry@gmail.com'
  );

create policy "Authenticated users can view council configs"
  on council_portal_configs for select
  using (auth.role() = 'authenticated');

-- ═══════════════════════════════════════════════════════════════════
-- DONE — what you get:
--   demo_requests          → captured from Book A Demo form
--   leads                  → planning applications per customer (dashboard table)
--   contacts               → leads saved by admin, visible to all subscribers
--   council_portal_configs → registry of all UK council portal types + capabilities
--                            query example:
--                            SELECT council_name, software_type
--                            FROM council_portal_configs
--                            ORDER BY capability_embedding <=> '[0.1, 0.2, ...]'
--                            LIMIT 10;
-- ═══════════════════════════════════════════════════════════════════
