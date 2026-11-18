-- ====================================================================
-- AAVIN Tanker Journey & Plant Processing Schema Patch
-- Supports: 7-stage strictly ordered tanker pipeline, team ownership,
-- audit log corrections with mandatory reasons, and auto-flag metrics.
-- ====================================================================

-- 1. Create tanker_stages table for granular stage execution records
create table if not exists tanker_stages (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references tanker_dispatches(id) on delete cascade not null,
  stage_name text not null, -- 'vehicle_entered', 'gross_weight', 'qc_completed', 'unloaded', 'tare_weight', 'cip_completed', 'vehicle_exit'
  team text not null,       -- 'gate', 'qc', 'unloading'
  status text not null,     -- 'done', 'rejected', 'skipped'
  stage_data jsonb default '{}'::jsonb,
  done_by uuid references auth.users(id),
  done_by_name text,
  done_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_tanker_stages_trip on tanker_stages (trip_id, done_at);

-- 2. Extend tanker_dispatches with pipeline state & calculated metrics
alter table tanker_dispatches add column if not exists trip_status text default 'on_the_way';
alter table tanker_dispatches add column if not exists current_stage text default 'vehicle_entered';
alter table tanker_dispatches add column if not exists waiting_team text default 'gate';
alter table tanker_dispatches add column if not exists qc_status text; -- 'accepted', 'rejected'
alter table tanker_dispatches add column if not exists qc_rejection_reason text;
alter table tanker_dispatches add column if not exists gross_weight_kg decimal(10,2);
alter table tanker_dispatches add column if not exists tare_weight_kg decimal(10,2);
alter table tanker_dispatches add column if not exists net_weight_kg decimal(10,2);
alter table tanker_dispatches add column if not exists net_litres decimal(10,2);
alter table tanker_dispatches add column if not exists unloaded_litres decimal(10,2);
alter table tanker_dispatches add column if not exists unloading_bay text;
alter table tanker_dispatches add column if not exists weighbridge_gross_ticket text;
alter table tanker_dispatches add column if not exists weighbridge_tare_ticket text;
alter table tanker_dispatches add column if not exists gate_pass_no text;
alter table tanker_dispatches add column if not exists exit_gate_pass_no text;
alter table tanker_dispatches add column if not exists seal_condition text default 'intact'; -- 'intact', 'broken', 'tampered'
alter table tanker_dispatches add column if not exists cip_status text; -- 'pass', 'fail', 'completed'
alter table tanker_dispatches add column if not exists total_turnaround_min integer;
alter table tanker_dispatches add column if not exists is_delayed boolean default false;
alter table tanker_dispatches add column if not exists dc_number text;
alter table tanker_dispatches add column if not exists stage_data jsonb default '{}'::jsonb;
alter table tanker_dispatches add column if not exists remarks jsonb default '[]'::jsonb;

create index if not exists idx_tanker_dispatches_status on tanker_dispatches (zone_id, trip_status);
create index if not exists idx_tanker_dispatches_stage on tanker_dispatches (zone_id, current_stage);

-- 3. Extend zone_settings with tanker pipeline thresholds & time limits
alter table zone_settings add column if not exists stage_time_limits_min jsonb default '{"vehicle_entered":15,"gross_weight":15,"qc_completed":30,"unloaded":45,"tare_weight":15,"cip_completed":30,"vehicle_exit":15}'::jsonb;
alter table zone_settings add column if not exists transit_loss_warn_pct decimal(5,2) default 0.50;
alter table zone_settings add column if not exists transit_loss_danger_pct decimal(5,2) default 1.50;
alter table zone_settings add column if not exists net_weight_diff_threshold_kg decimal(10,2) default 50.00;
alter table zone_settings add column if not exists quality_drop_threshold_fat decimal(5,2) default 0.20;
alter table zone_settings add column if not exists quality_drop_threshold_snf decimal(5,2) default 0.20;
alter table zone_settings add column if not exists milk_density_kg_per_litre decimal(6,3) default 1.030;
alter table zone_settings add column if not exists auto_refresh_interval_sec integer default 30;

-- 4. Enable RLS and setup policies
alter table tanker_stages enable row level security;

create policy "tanker_stages_read_all" on tanker_stages
  for select using (auth.role() = 'authenticated');

create policy "tanker_stages_insert_plant" on tanker_stages
  for insert with check (auth.role() = 'authenticated');

create policy "tanker_stages_update_admin" on tanker_stages
  for update using (auth.role() = 'authenticated');
