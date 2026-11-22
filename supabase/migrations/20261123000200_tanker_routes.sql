-- ============================================================================
-- AAVIN: tanker driver + route, and a hard limit on BMC dispatch
--
--   tankers.driver_name / driver_phone  entered by admin when registering
--   tankers.route_bmc_ids               BMCs the tanker collects from (admin picks)
--   dispatch_to_tanker()                now also
--     * refuses a BMC that is not on the tanker's route (empty route = any BMC)
--     * refuses a dispatch larger than the BMC's available milk
--       (collected net of rejections minus litres already on tankers)
--     * takes the driver from the tanker when none is sent
-- ============================================================================

alter table public.tankers
  add column driver_name text,
  add column driver_phone text,
  add column route_bmc_ids bigint[] not null default '{}';

create or replace function public.dispatch_to_tanker(p jsonb)
returns bigint
language plpgsql
set search_path = ''
as $function$
declare
  v_tanker     public.tankers%rowtype;
  v_trip       public.tanker_trips%rowtype;
  v_bmc        public.bmcs%rowtype;
  v_row        jsonb;
  v_cell       jsonb;
  v_cell_cap   numeric;
  v_cell_have  numeric;
  v_qty        numeric;
  v_total      numeric;
  v_collected  numeric;
  v_sent       numeric;
  v_available  numeric;
  v_req        text := nullif(p ->> 'client_request_id', '');
  v_existing   bigint;
  v_at         timestamptz := coalesce((p ->> 'dispatch_at')::timestamptz, now());
  v_user       bigint := nullif(p ->> 'created_by', '')::bigint;
  v_driver     text;
  v_phone      text;
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

  -- lock the BMC row so two dispatches cannot both use the same milk
  select * into v_bmc from public.bmcs where id = (p ->> 'bmc_id')::bigint for update;
  if not found or v_bmc.dairy_unit_id is distinct from v_tanker.dairy_unit_id then
    raise exception 'This tanker is assigned to a different dairy unit' using errcode = 'P0001';
  end if;

  if cardinality(v_tanker.route_bmc_ids) > 0 and not (v_bmc.id = any (v_tanker.route_bmc_ids)) then
    raise exception 'Tanker % is not assigned to %', v_tanker.vehicle_number, v_bmc.name using errcode = 'P0001';
  end if;

  select coalesce(sum((l ->> 'quantity_litres')::numeric), 0) into v_total
    from jsonb_array_elements(p -> 'loadings') l;

  select coalesce(sum(greatest(0, m.quantity_litres - m.rejection_qty)), 0) into v_collected
    from public.milk_entries m where m.bmc_id = v_bmc.id;
  select coalesce(sum(l.quantity_litres), 0) into v_sent
    from public.trip_loadings l
    join public.tanker_trips t on t.id = l.trip_id and t.status <> 'cancelled'
   where l.bmc_id = v_bmc.id;
  v_available := greatest(0, v_collected - v_sent);

  if v_total > v_available then
    raise exception 'Only % L of milk is available at % (collected % L, already dispatched % L). You entered % L.',
      round(v_available, 1), v_bmc.name, round(v_collected, 1), round(v_sent, 1), round(v_total, 1)
      using errcode = 'P0001';
  end if;

  v_driver := coalesce(nullif(p ->> 'driver_name', ''), v_tanker.driver_name);
  v_phone  := coalesce(nullif(p ->> 'driver_phone', ''), v_tanker.driver_phone);

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
       v_tanker.cells, v_tanker.total_capacity_litres, v_driver, v_phone, v_user)
    returning * into v_trip;
  else
    update public.tanker_trips
       set driver_name  = coalesce(v_driver, driver_name),
           driver_phone = coalesce(v_phone, driver_phone)
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
$function$;
