-- ============================================================================
-- Add Gate Pass columns and stage support
-- ============================================================================

-- 1. Allow 'gate_pass' in trip_stages stage_key check
alter table public.trip_stages drop constraint if exists trip_stages_stage_key_check;
alter table public.trip_stages add constraint trip_stages_stage_key_check check (stage_key in (
  'vehicle_entered', 'gross_weight', 'qc_completed', 'unloaded',
  'tare_weight', 'cip_completed', 'gate_pass', 'vehicle_exit'
));

-- 2. Add gate_pass columns on tanker_trips
alter table public.tanker_trips add column if not exists gate_pass jsonb;
alter table public.tanker_trips add column if not exists gate_pass_no text;

-- 3. Allow 'gate_pass_issued' in status if applicable
alter table public.tanker_trips drop constraint if exists tanker_trips_status_check;
alter table public.tanker_trips add constraint tanker_trips_status_check check (status in (
  'on_the_way', 'vehicle_entered', 'gross_done', 'qc_done', 'qc_rejected',
  'unloaded', 'tare_done', 'cip_done', 'cip_unsatisfied', 'gate_pass_issued', 'exited', 'cancelled'
));
