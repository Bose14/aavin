-- ============================================================================
-- AAVIN: tanker master, trips, BMC loadings and plant stage records
--
--   tankers        vehicle master (cells + current dairy unit)
--   tanker_trips   one journey; destination dairy unit fixed per trip
--   trip_loadings  one row per BMC per cell filled (feeds the Milk ACK report)
--   trip_stages    one row per plant stage record (gate entry, gross, QC, unloading,
--                  tare, CIP, exit); report fields are real columns on the trip,
--                  the full form content is kept in trip_stages.data
--
-- Replaces registered_tankers and tanker_dispatches (trips start clean; the
-- registered vehicles are carried over into tankers).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. tankers
-- ---------------------------------------------------------------------------
create table public.tankers (
  id                    bigint generated always as identity primary key,
  id_token              text not null unique check (id_token ~ '^[A-Z]{2}00[A-Z]{4}[0-9]{3}$'),
  vehicle_number        text not null,
  contractor_name       text not null,
  supplier_name         text not null,
  vehicle_type          text,
  from_date             date,
  cells                 jsonb not null check (jsonb_typeof(cells) = 'array' and jsonb_array_length(cells) between 1 and 3),
  total_capacity_litres numeric(10, 2) not null check (total_capacity_litres > 0),
  dairy_unit_id         bigint not null references public.dairy_units (id),
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index uq_tankers_vehicle on public.tankers (upper(regexp_replace(vehicle_number, '[^A-Za-z0-9]', '', 'g')));
create index idx_tankers_dairy_unit on public.tankers (dairy_unit_id) where is_active;
create trigger tankers_id_token before insert or update on public.tankers
  for each row execute function public.set_id_token('TK');
create trigger tankers_touch before update on public.tankers
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. tanker_trips
-- ---------------------------------------------------------------------------
create table public.tanker_trips (
  id                bigint generated always as identity primary key,
  id_token          text not null unique check (id_token ~ '^[A-Z]{2}00[A-Z]{4}[0-9]{3}$'),
  tanker_id         bigint not null references public.tankers (id),
  dairy_unit_id     bigint not null references public.dairy_units (id),
  trip_date         date not null,
  status            text not null default 'on_the_way' check (status in (
                      'on_the_way', 'vehicle_entered', 'gross_done', 'qc_done', 'qc_rejected',
                      'unloaded', 'tare_done', 'cip_done', 'cip_unsatisfied', 'exited', 'cancelled')),
  cells             jsonb not null,
  capacity_litres   numeric(10, 2) not null,
  loaded_litres     numeric(10, 2) not null default 0 check (loaded_litres >= 0),
  driver_name       text,
  driver_phone      text,
  gross_weight_kg   numeric(10, 2),
  tare_weight_kg    numeric(10, 2),
  net_weight_kg     numeric(10, 2),
  received_litres   numeric(10, 2),
  received_fat_pct  numeric(5, 2),
  received_snf_pct  numeric(5, 2),
  qc_status         text check (qc_status in ('accepted', 'rejected')),
  cip_status        text check (cip_status in ('pass', 'unsatisfied')),
  entered_at        timestamptz,
  exited_at         timestamptz,
  created_by        bigint references public.users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (loaded_litres <= capacity_litres)
);
-- a tanker can have only one trip that has not finished
-- (a QC-rejected trip keeps that status after the vehicle leaves, so "finished" means exited_at is set)
create unique index uq_tanker_trips_one_open on public.tanker_trips (tanker_id)
  where exited_at is null and status <> 'cancelled';
create index idx_tanker_trips_unit_date   on public.tanker_trips (dairy_unit_id, trip_date desc);
create index idx_tanker_trips_unit_status on public.tanker_trips (dairy_unit_id, status);
create trigger tanker_trips_id_token before insert or update on public.tanker_trips
  for each row execute function public.set_id_token('TR');
create trigger tanker_trips_touch before update on public.tanker_trips
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. trip_loadings: one row per BMC per cell
-- ---------------------------------------------------------------------------
create table public.trip_loadings (
  id                 bigint generated always as identity primary key,
  id_token           text not null unique check (id_token ~ '^[A-Z]{2}00[A-Z]{4}[0-9]{3}$'),
  trip_id            bigint not null references public.tanker_trips (id) on delete cascade,
  bmc_id             bigint not null references public.bmcs (id),
  cell_key           text not null check (cell_key in ('FC', 'MC', 'BC')),
  dc_number          text not null,
  outlet_seal_no     text,
  cell_seal_no       text,
  shift              text check (shift in ('MOR', 'EVE')),
  milk_type          text not null default 'RCM',
  quantity_litres    numeric(10, 2) not null check (quantity_litres > 0),
  fat_pct            numeric(5, 2) check (fat_pct is null or (fat_pct >= 0 and fat_pct <= 15)),
  snf_pct            numeric(5, 2) check (snf_pct is null or (snf_pct >= 0 and snf_pct <= 15)),
  temperature        numeric(5, 1),
  dispatch_time_text text,
  dispatch_at        timestamptz not null default now(),
  client_request_id  text,
  created_by         bigint references public.users (id),
  created_at         timestamptz not null default now(),
  unique (trip_id, bmc_id, dc_number, cell_key)
);
create index idx_trip_loadings_trip     on public.trip_loadings (trip_id);
create index idx_trip_loadings_bmc_time on public.trip_loadings (bmc_id, dispatch_at desc);
create index idx_trip_loadings_request  on public.trip_loadings (client_request_id) where client_request_id is not null;
create trigger trip_loadings_id_token before insert or update on public.trip_loadings
  for each row execute function public.set_id_token('LD');

-- ---------------------------------------------------------------------------
-- 4. trip_stages
-- ---------------------------------------------------------------------------
create table public.trip_stages (
  id           bigint generated always as identity primary key,
  id_token     text not null unique check (id_token ~ '^[A-Z]{2}00[A-Z]{4}[0-9]{3}$'),
  trip_id      bigint not null references public.tanker_trips (id) on delete cascade,
  stage_key    text not null check (stage_key in (
                 'vehicle_entered', 'gross_weight', 'qc_completed', 'unloaded',
                 'tare_weight', 'cip_completed', 'vehicle_exit')),
  team         text not null check (team in ('gate', 'qc', 'unloading')),
  status       text not null check (status in ('done', 'rejected', 'skipped')),
  done_by      bigint references public.users (id) on delete set null,
  done_by_name text,
  done_at      timestamptz not null default now(),
  data         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- one passing record per stage per trip (a failed CIP can be repeated)
create unique index uq_trip_stages_done on public.trip_stages (trip_id, stage_key) where status = 'done';
create index idx_trip_stages_trip on public.trip_stages (trip_id, stage_key, done_at desc);
create trigger trip_stages_id_token before insert or update on public.trip_stages
  for each row execute function public.set_id_token('SG');
create trigger trip_stages_touch before update on public.trip_stages
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5. dispatch_to_tanker: one atomic call for a BMC dispatch
--    * locks the tanker, finds its open trip (or starts one)
--    * a trip accepts loadings only until the gate entry (status 'on_the_way')
--    * checks the capacity of every cell against what is already loaded
--    * replaying the same client_request_id returns the existing trip
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_to_tanker(p jsonb)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_tanker     public.tankers%rowtype;
  v_trip       public.tanker_trips%rowtype;
  v_bmc        public.bmcs%rowtype;
  v_row        jsonb;
  v_cell       jsonb;
  v_cell_cap   numeric;
  v_cell_have  numeric;
  v_qty        numeric;
  v_req        text := nullif(p ->> 'client_request_id', '');
  v_existing   bigint;
  v_at         timestamptz := coalesce((p ->> 'dispatch_at')::timestamptz, now());
  v_user       bigint := nullif(p ->> 'created_by', '')::bigint;
begin
  if v_req is not null then
    select l.trip_id into v_existing from public.trip_loadings l where l.client_request_id = v_req limit 1;
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  select * into v_tanker from public.tankers where id = (p ->> 'tanker_id')::bigint for update;
  if not found or not v_tanker.is_active then
    raise exception 'Tanker not found or inactive' using errcode = 'P0001';
  end if;

  select * into v_bmc from public.bmcs where id = (p ->> 'bmc_id')::bigint;
  if not found or v_bmc.dairy_unit_id is distinct from v_tanker.dairy_unit_id then
    raise exception 'This tanker is assigned to a different dairy unit' using errcode = 'P0001';
  end if;

  select * into v_trip from public.tanker_trips
   where tanker_id = v_tanker.id and exited_at is null and status <> 'cancelled'
   for update;

  if found and v_trip.status <> 'on_the_way' then
    raise exception 'Tanker % has already reached the dairy unit and cannot be loaded', v_tanker.vehicle_number
      using errcode = 'P0001';
  end if;

  if not found then
    insert into public.tanker_trips
      (tanker_id, dairy_unit_id, trip_date, cells, capacity_litres, driver_name, driver_phone, created_by)
    values
      (v_tanker.id, v_tanker.dairy_unit_id, coalesce((p ->> 'trip_date')::date, (v_at at time zone 'Asia/Kolkata')::date),
       v_tanker.cells, v_tanker.total_capacity_litres,
       nullif(p ->> 'driver_name', ''), nullif(p ->> 'driver_phone', ''), v_user)
    returning * into v_trip;
  else
    update public.tanker_trips
       set driver_name  = coalesce(nullif(p ->> 'driver_name', ''), driver_name),
           driver_phone = coalesce(nullif(p ->> 'driver_phone', ''), driver_phone)
     where id = v_trip.id;
  end if;

  for v_row in select * from jsonb_array_elements(p -> 'loadings') loop
    v_qty := (v_row ->> 'quantity_litres')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Quantity must be greater than zero' using errcode = 'P0001';
    end if;

    select c into v_cell from jsonb_array_elements(v_trip.cells) c where c ->> 'cell_key' = v_row ->> 'cell_key';
    if v_cell is null then
      raise exception 'Tanker % has no cell %', v_tanker.vehicle_number, v_row ->> 'cell_key' using errcode = 'P0001';
    end if;
    v_cell_cap := (v_cell ->> 'capacity_litres')::numeric;

    select coalesce(sum(quantity_litres), 0) into v_cell_have
      from public.trip_loadings where trip_id = v_trip.id and cell_key = v_row ->> 'cell_key';

    if v_cell_have + v_qty > v_cell_cap then
      raise exception 'Cell % can take only % more litres (capacity %, loaded %)',
        v_row ->> 'cell_key', v_cell_cap - v_cell_have, v_cell_cap, v_cell_have using errcode = 'P0001';
    end if;

    insert into public.trip_loadings
      (trip_id, bmc_id, cell_key, dc_number, outlet_seal_no, cell_seal_no, shift, milk_type,
       quantity_litres, fat_pct, snf_pct, temperature, dispatch_time_text, dispatch_at,
       client_request_id, created_by)
    values
      (v_trip.id, v_bmc.id, v_row ->> 'cell_key', p ->> 'dc_number', nullif(p ->> 'outlet_seal_no', ''),
       nullif(v_row ->> 'seal_number', ''), nullif(p ->> 'shift', ''), coalesce(nullif(v_row ->> 'milk_type', ''), 'RCM'),
       v_qty, nullif(v_row ->> 'fat_pct', '')::numeric, nullif(v_row ->> 'snf_pct', '')::numeric,
       nullif(v_row ->> 'temperature', '')::numeric, nullif(p ->> 'dispatch_time_text', ''), v_at,
       v_req, v_user);
  end loop;

  update public.tanker_trips
     set loaded_litres = (select coalesce(sum(quantity_litres), 0) from public.trip_loadings where trip_id = v_trip.id)
   where id = v_trip.id;

  return v_trip.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. BMC stock = milk collected (net of rejections) minus litres loaded on tankers
-- ---------------------------------------------------------------------------
create or replace view public.v_bmc_stock with (security_invoker = true) as
select
  b.id as bmc_id,
  b.dairy_unit_id,
  coalesce((select sum(greatest(0, m.quantity_litres - m.rejection_qty))
              from public.milk_entries m where m.bmc_id = b.id), 0) as collected_litres,
  coalesce((select sum(l.quantity_litres)
              from public.trip_loadings l
              join public.tanker_trips t on t.id = l.trip_id and t.status <> 'cancelled'
             where l.bmc_id = b.id), 0) as dispatched_litres
from public.bmcs b;

-- ---------------------------------------------------------------------------
-- 7. carry the registered vehicles over, drop the old tables
-- ---------------------------------------------------------------------------
insert into public.tankers
  (vehicle_number, contractor_name, supplier_name, vehicle_type, from_date, cells, total_capacity_litres,
   dairy_unit_id, created_at)
select
  upper(btrim(r.vehicle_number)),
  r.contractor_name,
  r.supplier_name,
  r.vehicle_type,
  r.from_date,
  c.cells,
  c.total,
  coalesce((select id from public.dairy_units where name = 'Namakkal'), (select min(id) from public.dairy_units)),
  coalesce(r.created_at, now())
from public.registered_tankers r
cross join lateral (
  select
    (select coalesce(jsonb_agg(x.cell order by x.ord), '[]'::jsonb) from (
       select 1 as ord, jsonb_build_object('cell_key', 'FC', 'capacity_litres', r.front_cell_capacity)  as cell where coalesce(r.front_cell_capacity, 0)  > 0
       union all
       select 2,        jsonb_build_object('cell_key', 'MC', 'capacity_litres', r.middle_cell_capacity) where coalesce(r.middle_cell_capacity, 0) > 0
       union all
       select 3,        jsonb_build_object('cell_key', 'BC', 'capacity_litres', r.back_cell_capacity)   where coalesce(r.back_cell_capacity, 0)   > 0
     ) x) as cells,
    coalesce(r.front_cell_capacity, 0) + coalesce(r.middle_cell_capacity, 0) + coalesce(r.back_cell_capacity, 0) as total
) c
where c.total > 0
order by r.created_at;

drop table public.registered_tankers;
drop table public.tanker_dispatches;

-- ---------------------------------------------------------------------------
-- 8. Row level security: only the backend (service role) reads and writes these
-- ---------------------------------------------------------------------------
alter table public.tankers       enable row level security;
alter table public.tanker_trips  enable row level security;
alter table public.trip_loadings enable row level security;
alter table public.trip_stages   enable row level security;

notify pgrst, 'reload schema';
