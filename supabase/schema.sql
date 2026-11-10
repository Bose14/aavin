-- ============================================================
-- AAVIN INTERNAL PLATFORM — SUPABASE SCHEMA
-- Run this entire file in Supabase SQL Editor (once)
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- ZONES
-- ============================================================
create table zones (
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
  ('Perambalur');

-- ============================================================
-- UNITS (village collection points)
-- ============================================================
create table units (
  id uuid primary key default uuid_generate_v4(),
  zone_id uuid not null references zones(id),
  name text not null,
  location text,
  unit_code text unique not null,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'unit')),
  zone_id uuid references zones(id),
  unit_id uuid references units(id),
  full_name text,
  phone text,
  created_at timestamptz default now()
);

-- ============================================================
-- MILK ENTRIES (daily collection data per shift)
-- ============================================================
create table milk_entries (
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

-- ============================================================
-- TANKER DISPATCHES
-- ============================================================
create table tanker_dispatches (
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

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table zones enable row level security;
alter table units enable row level security;
alter table profiles enable row level security;
alter table milk_entries enable row level security;
alter table tanker_dispatches enable row level security;

-- Helper: get current user's zone_id
create or replace function auth_zone_id()
returns uuid language sql security definer stable as $$
  select zone_id from profiles where id = auth.uid();
$$;

-- Helper: get current user's unit_id
create or replace function auth_unit_id()
returns uuid language sql security definer stable as $$
  select unit_id from profiles where id = auth.uid();
$$;

-- Helper: get current user's role
create or replace function auth_role()
returns text language sql security definer stable as $$
  select role from profiles where id = auth.uid();
$$;

-- ZONES: everyone can read (needed for registration dropdown)
create policy "zones_read" on zones for select using (true);

-- UNITS: read if same zone
create policy "units_read_zone" on units for select
  using (zone_id = auth_zone_id());

-- UNITS: admin can write in their zone
create policy "units_admin_write" on units for insert
  with check (auth_role() = 'admin' and zone_id = auth_zone_id());

create policy "units_admin_update" on units for update
  using (auth_role() = 'admin' and zone_id = auth_zone_id());

-- PROFILES: own profile
create policy "profiles_own_read" on profiles for select using (id = auth.uid());
create policy "profiles_own_update" on profiles for update using (id = auth.uid());
create policy "profiles_insert" on profiles for insert with check (id = auth.uid());

-- PROFILES: admin reads all profiles in their zone
create policy "profiles_admin_zone" on profiles for select
  using (auth_role() = 'admin' and zone_id = auth_zone_id());

-- MILK ENTRIES: unit reads/writes their own; admin reads whole zone
create policy "milk_unit_rw" on milk_entries for all
  using (
    (auth_role() = 'unit' and unit_id = auth_unit_id())
    or
    (auth_role() = 'admin' and zone_id = auth_zone_id())
  )
  with check (
    (auth_role() = 'unit' and unit_id = auth_unit_id() and zone_id = auth_zone_id())
    or
    (auth_role() = 'admin' and zone_id = auth_zone_id())
  );

-- TANKER DISPATCHES: same logic
create policy "tanker_unit_rw" on tanker_dispatches for all
  using (
    (auth_role() = 'unit' and unit_id = auth_unit_id())
    or
    (auth_role() = 'admin' and zone_id = auth_zone_id())
  )
  with check (
    (auth_role() = 'unit' and unit_id = auth_unit_id() and zone_id = auth_zone_id())
    or
    (auth_role() = 'admin' and zone_id = auth_zone_id())
  );

-- ============================================================
-- AUTO-REGISTER UNIT ON units TABLE INSERT (helper view)
-- ============================================================
-- Useful index for analytics queries
create index on milk_entries (zone_id, date);
create index on milk_entries (unit_id, date);
create index on tanker_dispatches (zone_id, date);
create index on tanker_dispatches (unit_id, date);
