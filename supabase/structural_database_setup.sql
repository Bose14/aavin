-- ====================================================================
-- AAVIN DAIRY MANAGEMENT SYSTEM — STRUCTURAL DATABASE SETUP
-- Master Idempotent Migration Script
-- Safe to run on brand-new OR existing Supabase projects.
-- Run in: Supabase Dashboard > SQL Editor > Click "Run"
-- ====================================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ====================================================================
-- 1. ZONES
-- ====================================================================
create table if not exists zones (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  created_at timestamptz default now()
);

-- Seed initial Tamil Nadu districts
insert into zones (name) values
  ('Namakkal'),
  ('Erode'),
  ('Salem'),
  ('Tiruchirappalli'),
  ('Coimbatore'),
  ('Dharmapuri'),
  ('Krishnagiri'),
  ('Karur'),
  ('Perambalur')
on conflict (name) do nothing;

-- ====================================================================
-- 2. TEAMS (Fixed Plant Processing Teams)
-- ====================================================================
create table if not exists teams (
  id uuid primary key default uuid_generate_v4(),
  code text unique not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Seed fixed plant teams with deterministic UUIDs
insert into teams (id, code, name, active)
values
  ('11111111-1111-4111-8111-111111111111', 'GATE', 'Gate Operations Team', true),
  ('22222222-2222-4222-8222-222222222222', 'QC', 'Quality Control (QC) Team', true),
  ('33333333-3333-4333-8333-333333333333', 'UNLOADING', 'Milk Unloading Team', true)
on conflict (code) do update
set name = excluded.name, active = excluded.active;

-- ====================================================================
-- 3. UNITS (BMC - Bulk Milk Cooling Centers)
-- ====================================================================
create table if not exists units (
  id uuid primary key default uuid_generate_v4(),
  zone_id uuid not null references zones(id),
  name text not null,
  location text,
  unit_code text unique not null,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- ====================================================================
-- 4. PROFILES (Extends Supabase auth.users)
-- ====================================================================
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'unit',
  zone_id uuid references zones(id),
  unit_id uuid references units(id),
  team_id uuid references teams(id),
  shift text default 'General',
  username text,
  full_name text,
  phone text,
  sub_role text default 'operator',
  is_active boolean default true,
  must_change_password boolean default false,
  created_at timestamptz default now()
);

-- Ensure all columns exist on profiles table
alter table profiles add column if not exists role text not null default 'unit';
alter table profiles add column if not exists zone_id uuid references zones(id);
alter table profiles add column if not exists unit_id uuid references units(id);
alter table profiles add column if not exists team_id uuid references teams(id);
alter table profiles add column if not exists shift text default 'General';
alter table profiles add column if not exists username text;
alter table profiles add column if not exists full_name text;
alter table profiles add column if not exists phone text;
alter table profiles add column if not exists sub_role text default 'operator';
alter table profiles add column if not exists is_active boolean default true;
alter table profiles add column if not exists must_change_password boolean default false;
alter table profiles add column if not exists created_at timestamptz default now();

-- Update role constraint to allow all plant team and administrative roles
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('superadmin', 'admin', 'unit', 'gate', 'qc', 'unloading', 'GATE', 'QC', 'UNLOADING'));

-- Update shift constraint
alter table profiles drop constraint if exists profiles_shift_check;
alter table profiles add constraint profiles_shift_check
  check (shift in ('Morning', 'Evening', 'General'));

-- Profiles Indexes
create index if not exists idx_profiles_zone on profiles(zone_id);
create index if not exists idx_profiles_unit on profiles(unit_id);
create index if not exists idx_profiles_team on profiles(team_id);
create index if not exists idx_profiles_role on profiles(role);
create index if not exists idx_profiles_phone on profiles(phone);
create unique index if not exists idx_profiles_zone_username on profiles(zone_id, lower(username)) where username is not null;

-- ====================================================================
-- 5. MILK ENTRIES (BMC Shift Milk Collection Records)
-- ====================================================================
create table if not exists milk_entries (
  id uuid primary key default uuid_generate_v4(),
  unit_id uuid not null references units(id),
  zone_id uuid not null references zones(id),
  date date not null,
  shift text not null check (shift in ('AM', 'PM')),
  fat_pct decimal(5,2) not null check (fat_pct >= 0 and fat_pct <= 15),
  snf_pct decimal(5,2) not null check (snf_pct >= 0 and snf_pct <= 15),
  quantity_litres decimal(10,2) not null check (quantity_litres >= 0),
  rejection_qty decimal(10,2) default 0 check (rejection_qty >= 0),
  temperature decimal(5,1),
  rate_per_litre decimal(6,2) not null,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  unique(unit_id, date, shift)
);

create index if not exists idx_milk_entries_zone_date on milk_entries(zone_id, date);
create index if not exists idx_milk_entries_unit_date on milk_entries(unit_id, date);

-- ====================================================================
-- 6. TANKER DISPATCHES (Milk Tanker Movement & Plant Reception)
-- ====================================================================
create table if not exists tanker_dispatches (
  id uuid primary key default uuid_generate_v4(),
  unit_id uuid not null references units(id),
  zone_id uuid not null references zones(id),
  date date not null,
  tanker_number text not null,
  quantity_dispatched decimal(10,2) not null check (quantity_dispatched >= 0),
  destination text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- Ensure all operational & stage progression columns exist
alter table tanker_dispatches add column if not exists dc_number text;
alter table tanker_dispatches add column if not exists driver_name text;
alter table tanker_dispatches add column if not exists seal_number text;
alter table tanker_dispatches add column if not exists dispatch_time text;
alter table tanker_dispatches add column if not exists receipt_time text;
alter table tanker_dispatches add column if not exists trip_status text default 'on_the_way';
alter table tanker_dispatches add column if not exists current_stage text default 'vehicle_entered';
alter table tanker_dispatches add column if not exists waiting_team text default 'gate';
alter table tanker_dispatches add column if not exists qc_status text default 'pending';
alter table tanker_dispatches add column if not exists qc_rejection_reason text;
alter table tanker_dispatches add column if not exists gross_weight_kg decimal(10,2);
alter table tanker_dispatches add column if not exists tare_weight_kg decimal(10,2);
alter table tanker_dispatches add column if not exists net_weight_kg decimal(10,2);
alter table tanker_dispatches add column if not exists net_litres decimal(10,2);
alter table tanker_dispatches add column if not exists unloaded_litres decimal(10,2);
alter table tanker_dispatches add column if not exists received_qty decimal(10,2);
alter table tanker_dispatches add column if not exists received_fat_pct decimal(5,2);
alter table tanker_dispatches add column if not exists received_snf_pct decimal(5,2);
alter table tanker_dispatches add column if not exists unloading_bay text;
alter table tanker_dispatches add column if not exists weighbridge_gross_ticket text;
alter table tanker_dispatches add column if not exists weighbridge_tare_ticket text;
alter table tanker_dispatches add column if not exists gate_pass_no text;
alter table tanker_dispatches add column if not exists exit_gate_pass_no text;
alter table tanker_dispatches add column if not exists seal_condition text default 'intact';
alter table tanker_dispatches add column if not exists cip_status text;
alter table tanker_dispatches add column if not exists total_turnaround_min integer;
alter table tanker_dispatches add column if not exists is_delayed boolean default false;
alter table tanker_dispatches add column if not exists stage_data jsonb default '{}'::jsonb;
alter table tanker_dispatches add column if not exists remarks jsonb default '[]'::jsonb;

-- Tanker Indexes
create index if not exists idx_tanker_dispatches_zone_date on tanker_dispatches(zone_id, date);
create index if not exists idx_tanker_dispatches_status on tanker_dispatches(zone_id, trip_status);
create index if not exists idx_tanker_dispatches_waiting_team on tanker_dispatches(zone_id, waiting_team);
create index if not exists idx_tanker_dispatches_dc on tanker_dispatches(dc_number);

-- ====================================================================
-- 7. TANKER STAGES (Event-Sourced Journey Audit Trail)
-- ====================================================================
create table if not exists tanker_stages (
  id uuid primary key default uuid_generate_v4(),
  trip_id uuid references tanker_dispatches(id) on delete cascade not null,
  stage_name text not null,
  team text not null,
  status text not null default 'done',
  stage_data jsonb default '{}'::jsonb,
  done_by uuid references auth.users(id),
  done_by_name text,
  done_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(trip_id, stage_name)
);

create index if not exists idx_tanker_stages_trip on tanker_stages(trip_id, done_at);

-- ====================================================================
-- 8. AUDIT LOGS (Security & Compliance Tracking)
-- ====================================================================
create table if not exists audit_logs (
  id uuid primary key default uuid_generate_v4(),
  zone_id uuid not null references zones(id),
  unit_id uuid references units(id),
  entity_type text not null,
  entity_id text,
  action text not null,
  changes jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id),
  actor_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_zone_entity on audit_logs(zone_id, entity_type, created_at desc);

-- ====================================================================
-- 9. ZONE SETTINGS (Configurable SLAs, Tolerances & Density)
-- ====================================================================
create table if not exists zone_settings (
  id uuid primary key default uuid_generate_v4(),
  zone_id uuid not null unique references zones(id),
  stage_time_limits_min jsonb default '{"vehicle_entered":15,"gross_weight":15,"qc_completed":30,"unloaded":45,"tare_weight":15,"cip_completed":30,"vehicle_exit":15}'::jsonb,
  transit_loss_warn_pct decimal(5,2) default 0.50,
  transit_loss_danger_pct decimal(5,2) default 1.50,
  net_weight_diff_threshold_kg decimal(10,2) default 50.00,
  quality_drop_threshold_fat decimal(5,2) default 0.20,
  quality_drop_threshold_snf decimal(5,2) default 0.20,
  milk_density_kg_per_litre decimal(6,3) default 1.030,
  rejection_payment_rule text default 'net',
  auto_refresh_interval_sec integer default 30,
  updated_by uuid references auth.users(id),
  updated_at timestamptz default now()
);

-- ====================================================================
-- 10. ROW LEVEL SECURITY (RLS) POLICIES
-- ====================================================================
alter table zones enable row level security;
alter table teams enable row level security;
alter table units enable row level security;
alter table profiles enable row level security;
alter table milk_entries enable row level security;
alter table tanker_dispatches enable row level security;
alter table tanker_stages enable row level security;
alter table audit_logs enable row level security;
alter table zone_settings enable row level security;

-- Drop prior policies to allow clean idempotent re-creation
drop policy if exists "zones_read_all" on zones;
create policy "zones_read_all" on zones for select using (true);

drop policy if exists "teams_read_authenticated" on teams;
create policy "teams_read_authenticated" on teams for select using (auth.role() = 'authenticated');

drop policy if exists "teams_admin_all" on teams;
create policy "teams_admin_all" on teams for all using (auth.role() = 'authenticated');

drop policy if exists "units_read_authenticated" on units;
create policy "units_read_authenticated" on units for select using (auth.role() = 'authenticated');

drop policy if exists "units_admin_all" on units;
create policy "units_admin_all" on units for all using (auth.role() = 'authenticated');

drop policy if exists "profiles_read_authenticated" on profiles;
create policy "profiles_read_authenticated" on profiles for select using (auth.role() = 'authenticated');

drop policy if exists "profiles_all_authenticated" on profiles;
create policy "profiles_all_authenticated" on profiles for all using (auth.role() = 'authenticated');

drop policy if exists "milk_entries_all_authenticated" on milk_entries;
create policy "milk_entries_all_authenticated" on milk_entries for all using (auth.role() = 'authenticated');

drop policy if exists "tanker_dispatches_all_authenticated" on tanker_dispatches;
create policy "tanker_dispatches_all_authenticated" on tanker_dispatches for all using (auth.role() = 'authenticated');

drop policy if exists "tanker_stages_all_authenticated" on tanker_stages;
create policy "tanker_stages_all_authenticated" on tanker_stages for all using (auth.role() = 'authenticated');

drop policy if exists "audit_logs_all_authenticated" on audit_logs;
create policy "audit_logs_all_authenticated" on audit_logs for all using (auth.role() = 'authenticated');

drop policy if exists "zone_settings_all_authenticated" on zone_settings;
create policy "zone_settings_all_authenticated" on zone_settings for all using (auth.role() = 'authenticated');

-- ====================================================================
-- 11. RELOAD SUPABASE POSTGREST SCHEMA CACHE
-- Forces PostgREST to immediately discover new columns (shift, team_id, username, etc.)
-- ====================================================================
notify pgrst, 'reload schema';
