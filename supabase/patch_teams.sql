-- ====================================================================
-- AAVIN Plant Teams & User Roles Schema Patch
-- Supports: Fixed teams (GATE, QC, UNLOADING), stage ownership,
-- team shifts (Morning/Evening/General), and team user management.
-- ====================================================================

-- 1. Create teams table (id, code, name, active, created_at)
create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Seed initial fixed teams
insert into teams (id, code, name, active)
values
  ('11111111-1111-4111-8111-111111111111', 'GATE', 'Gate Operations Team', true),
  ('22222222-2222-4222-8222-222222222222', 'QC', 'Quality Control (QC) Team', true),
  ('33333333-3333-4333-8333-333333333333', 'UNLOADING', 'Milk Unloading Team', true)
on conflict (code) do update
set name = excluded.name, active = excluded.active;

-- 2. Add team_id, shift, and username columns to profiles
alter table profiles add column if not exists team_id uuid references teams(id);
alter table profiles add column if not exists shift text default 'General';
alter table profiles add column if not exists username text;

-- Update role check constraint on profiles to allow plant team roles
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('superadmin', 'admin', 'unit', 'gate', 'qc', 'unloading', 'GATE', 'QC', 'UNLOADING'));

-- Add shift check constraint on profiles
alter table profiles drop constraint if exists profiles_shift_check;
alter table profiles add constraint profiles_shift_check
  check (shift in ('Morning', 'Evening', 'General'));

-- Indexes
create index if not exists idx_profiles_team_id on profiles(team_id);
create index if not exists idx_profiles_role on profiles(role);
create index if not exists idx_teams_code on teams(code);

-- 3. Enable RLS and setup policies for teams
alter table teams enable row level security;

create policy "teams_read_authenticated" on teams
  for select using (auth.role() = 'authenticated');

create policy "teams_admin_all" on teams
  for all using (auth.role() = 'authenticated');
