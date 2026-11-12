-- ============================================================
-- AAVIN UX & OPERATIONS UPGRADE MIGRATION (Idempotent)
-- Run in Supabase SQL Editor after schema.sql & patch_superadmin.sql
-- ============================================================

-- 1. Zone-level configurable procurement & quality settings
create table if not exists zone_settings (
  zone_id uuid primary key references zones(id) on delete cascade,
  fat_min decimal(4,2) not null default 3.50,
  fat_max decimal(4,2) not null default 8.50,
  fat_benchmark decimal(4,2) not null default 4.00,
  snf_min decimal(4,2) not null default 8.00,
  snf_max decimal(4,2) not null default 9.50,
  snf_benchmark decimal(4,2) not null default 8.20,
  rejection_warn_pct decimal(5,2) not null default 5.00,
  rejection_danger_pct decimal(5,2) not null default 10.00,
  rate_base decimal(6,2) not null default 0.00,
  rate_fat_coeff decimal(6,2) not null default 3.50,
  rate_snf_coeff decimal(6,2) not null default 1.80,
  rejection_payment_rule text not null default 'net' check (rejection_payment_rule in ('net', 'gross')),
  edit_lock_hours integer not null default 24 check (edit_lock_hours >= 1),
  show_unit_profit boolean not null default false,
  destinations text[] not null default array['Namakkal Dairy', 'Salem Chilling Plant', 'Erode Dairy', 'Coimbatore Main Dairy'],
  locations text[] not null default array['Rasipuram', 'Namakkal', 'Tiruchengode', 'Paramathi Velur', 'Sendamangalam', 'Kolli Hills', 'Komarapalayam', 'Mohanur', 'Vennandur', 'Puduchatram', 'Other'],
  updated_at timestamptz default now()
);

-- 2. Effective-dated zone selling rates (prevents rewriting past profit history)
create table if not exists selling_rate_history (
  id uuid primary key default uuid_generate_v4(),
  zone_id uuid not null references zones(id) on delete cascade,
  rate_per_litre decimal(6,2) not null check (rate_per_litre > 0),
  effective_from date not null,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  unique(zone_id, effective_from)
);

-- 3. Extended profile fields (sub-role, active status, first-login password reset)
alter table profiles add column if not exists email text;
alter table profiles add column if not exists sub_role text default 'operator';
alter table profiles add column if not exists is_active boolean default true;
alter table profiles add column if not exists must_change_password boolean default false;

-- 4. Extended milk_entries fields (rejection reason, rate override, status, timestamps)
alter table milk_entries add column if not exists rejection_reason text;
alter table milk_entries add column if not exists rate_override boolean default false;
alter table milk_entries add column if not exists rate_override_reason text;
alter table milk_entries add column if not exists selling_rate_applied decimal(6,2);
alter table milk_entries add column if not exists status text default 'submitted';
alter table milk_entries add column if not exists verified_by uuid references auth.users(id);
alter table milk_entries add column if not exists verified_at timestamptz;
alter table milk_entries add column if not exists updated_by uuid references auth.users(id);
alter table milk_entries add column if not exists updated_at timestamptz;

-- 5. Extended tanker_dispatches fields (driver, seal, dispatch quality, admin receipt/transit)
alter table tanker_dispatches add column if not exists driver_name text;
alter table tanker_dispatches add column if not exists seal_number text;
alter table tanker_dispatches add column if not exists dispatch_time text;
alter table tanker_dispatches add column if not exists dispatch_fat_pct decimal(5,2);
alter table tanker_dispatches add column if not exists dispatch_snf_pct decimal(5,2);
alter table tanker_dispatches add column if not exists received_qty decimal(10,2);
alter table tanker_dispatches add column if not exists receipt_time text;
alter table tanker_dispatches add column if not exists received_fat_pct decimal(5,2);
alter table tanker_dispatches add column if not exists received_snf_pct decimal(5,2);
alter table tanker_dispatches add column if not exists received_by uuid references auth.users(id);

-- 6. Audit logs & post-lock correction requests
create table if not exists audit_logs (
  id uuid primary key default uuid_generate_v4(),
  zone_id uuid references zones(id) on delete cascade,
  unit_id uuid references units(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  changes jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id),
  actor_name text,
  created_at timestamptz default now()
);

create table if not exists correction_requests (
  id uuid primary key default uuid_generate_v4(),
  milk_entry_id uuid not null references milk_entries(id) on delete cascade,
  zone_id uuid not null references zones(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  requested_by uuid references auth.users(id),
  requested_by_name text,
  reason text not null,
  proposed_changes jsonb default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'resolved', 'rejected')),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_selling_rate_zone_date on selling_rate_history (zone_id, effective_from desc);
create index if not exists idx_audit_logs_entity on audit_logs (entity_type, entity_id, created_at desc);
create index if not exists idx_correction_requests_zone on correction_requests (zone_id, status, created_at desc);

alter table zone_settings enable row level security;
alter table selling_rate_history enable row level security;
alter table audit_logs enable row level security;
alter table correction_requests enable row level security;

drop policy if exists "zone_settings_read" on zone_settings;
create policy "zone_settings_read" on zone_settings for select
  using (zone_id = auth_zone_id() or auth_role() = 'superadmin');

drop policy if exists "zone_settings_admin_write" on zone_settings;
create policy "zone_settings_admin_write" on zone_settings for all
  using (auth_role() = 'admin' and zone_id = auth_zone_id())
  with check (auth_role() = 'admin' and zone_id = auth_zone_id());

drop policy if exists "selling_rate_read" on selling_rate_history;
create policy "selling_rate_read" on selling_rate_history for select
  using (zone_id = auth_zone_id() or auth_role() = 'superadmin');

drop policy if exists "audit_logs_read" on audit_logs;
create policy "audit_logs_read" on audit_logs for select
  using (zone_id = auth_zone_id() or auth_role() = 'superadmin');

drop policy if exists "correction_requests_rw" on correction_requests;
create policy "correction_requests_rw" on correction_requests for all
  using (
    (auth_role() = 'unit' and unit_id = auth_unit_id())
    or (auth_role() = 'admin' and zone_id = auth_zone_id())
  )
  with check (
    (auth_role() = 'unit' and unit_id = auth_unit_id() and zone_id = auth_zone_id())
    or (auth_role() = 'admin' and zone_id = auth_zone_id())
  );
