-- ============================================================================
-- AAVIN
--   1. Tables the app already expects but the live database never had:
--      zone_settings, selling_rate_history, audit_logs, correction_requests
--      (until now they silently fell back to a file that is lost on every deploy)
--   2. Fat/SNF rate charts (cow + buffalo), effective-dated, plus publish_rate_chart()
--   3. bmcs.milk_type: which chart a BMC's milk is priced with
--   4. Guard: editing/deleting a milk entry can never take a BMC's collected milk
--      below what is already loaded on tankers
-- ============================================================================

-- 1. settings / audit -------------------------------------------------------
create table public.zone_settings (
  dairy_unit_id bigint primary key references public.dairy_units (id) on delete cascade,
  fat_min numeric, fat_max numeric, fat_benchmark numeric,
  snf_min numeric, snf_max numeric, snf_benchmark numeric,
  rejection_warn_pct numeric, rejection_danger_pct numeric,
  rate_base numeric, rate_fat_coeff numeric, rate_snf_coeff numeric,
  rejection_payment_rule text check (rejection_payment_rule in ('net', 'gross')),
  edit_lock_hours numeric,
  show_unit_profit boolean,
  destinations text[], locations text[],
  stage_time_limits_min jsonb,
  transit_loss_warn_pct numeric, transit_loss_danger_pct numeric,
  net_weight_diff_threshold_kg numeric,
  quality_drop_threshold_fat numeric, quality_drop_threshold_snf numeric,
  milk_density_kg_per_litre numeric,
  auto_refresh_interval_sec numeric,
  updated_at timestamptz not null default now()
);

create table public.selling_rate_history (
  id bigint generated always as identity primary key,
  dairy_unit_id bigint not null references public.dairy_units (id) on delete cascade,
  rate_per_litre numeric(8, 2) not null check (rate_per_litre > 0),
  effective_from date not null,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (dairy_unit_id, effective_from)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  dairy_unit_id bigint not null references public.dairy_units (id) on delete cascade,
  bmc_id bigint,
  entity_type text not null,
  entity_id text,
  action text not null,
  changes jsonb not null default '{}'::jsonb,
  actor_id text,
  actor_name text,
  created_at timestamptz not null default now()
);
create index audit_logs_unit_created_idx on public.audit_logs (dairy_unit_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

create table public.correction_requests (
  id bigint generated always as identity primary key,
  milk_entry_id bigint not null references public.milk_entries (id) on delete cascade,
  dairy_unit_id bigint not null references public.dairy_units (id) on delete cascade,
  bmc_id bigint not null references public.bmcs (id) on delete cascade,
  requested_by text,
  requested_by_name text,
  reason text not null,
  proposed_changes jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'resolved', 'rejected')),
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index correction_requests_unit_idx on public.correction_requests (dairy_unit_id, bmc_id);

-- 2. rate charts ------------------------------------------------------------
create table public.rate_charts (
  id bigint generated always as identity primary key,
  dairy_unit_id bigint not null references public.dairy_units (id) on delete cascade,
  milk_type text not null check (milk_type in ('COW', 'BUFFALO')),
  effective_from date not null,
  name text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (dairy_unit_id, milk_type, effective_from)
);

create table public.rate_chart_cells (
  chart_id bigint not null references public.rate_charts (id) on delete cascade,
  fat numeric(4, 2) not null,
  snf numeric(4, 2) not null,
  rate numeric(7, 2) not null check (rate > 0),
  primary key (chart_id, fat, snf)
);

-- p: { dairy_unit_id, milk_type, effective_from, name, created_by,
--      fat_values: [..], snf_values: [..], rates: [[..per snf..] per fat] }
create or replace function public.publish_rate_chart(p jsonb)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_id    bigint;
  v_type  text  := upper(coalesce(p ->> 'milk_type', ''));
  v_fats  jsonb := p -> 'fat_values';
  v_snfs  jsonb := p -> 'snf_values';
  v_rates jsonb := p -> 'rates';
  nf      integer;
  ns      integer;
  i       integer;
begin
  if v_type not in ('COW', 'BUFFALO') then
    raise exception 'Milk type must be COW or BUFFALO' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_fats) <> 'array' or jsonb_typeof(v_snfs) <> 'array' or jsonb_typeof(v_rates) <> 'array' then
    raise exception 'Rate chart is not in the expected shape' using errcode = 'P0001';
  end if;
  nf := jsonb_array_length(v_fats);
  ns := jsonb_array_length(v_snfs);
  if nf = 0 or ns = 0 or jsonb_array_length(v_rates) <> nf then
    raise exception 'Rate chart needs at least one fat row and one SNF column, with a rate for each' using errcode = 'P0001';
  end if;
  for i in 0 .. nf - 1 loop
    if jsonb_typeof(v_rates -> i) <> 'array' or jsonb_array_length(v_rates -> i) <> ns then
      raise exception 'Fat row % does not have a rate for every SNF column', v_fats ->> i using errcode = 'P0001';
    end if;
  end loop;

  insert into public.rate_charts (dairy_unit_id, milk_type, effective_from, name, created_by)
  values ((p ->> 'dairy_unit_id')::bigint, v_type, (p ->> 'effective_from')::date,
          nullif(p ->> 'name', ''), nullif(p ->> 'created_by', ''))
  returning id into v_id;

  insert into public.rate_chart_cells (chart_id, fat, snf, rate)
  select v_id, (v_fats ->> i)::numeric, (v_snfs ->> j)::numeric, (v_rates -> i ->> j)::numeric
    from generate_series(0, nf - 1) i, generate_series(0, ns - 1) j;

  return v_id;
end;
$$;

-- 3. milk type per BMC ------------------------------------------------------
alter table public.bmcs
  add column milk_type text not null default 'COW' check (milk_type in ('COW', 'BUFFALO'));

-- 4. never let collected milk fall below dispatched ---------------------------
create or replace function public.guard_collected_not_below_dispatched()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old       numeric := greatest(0, old.quantity_litres - coalesce(old.rejection_qty, 0));
  v_new       numeric := 0;
  v_collected numeric;
  v_sent      numeric;
begin
  if tg_op = 'UPDATE' and new.bmc_id is not distinct from old.bmc_id then
    v_new := greatest(0, new.quantity_litres - coalesce(new.rejection_qty, 0));
  end if;
  if v_new >= v_old then
    return null;                      -- nothing was taken away
  end if;

  perform 1 from public.bmcs where id = old.bmc_id for update;   -- same lock dispatch_to_tanker takes

  select coalesce(sum(greatest(0, quantity_litres - coalesce(rejection_qty, 0))), 0)
    into v_collected from public.milk_entries where bmc_id = old.bmc_id;
  select coalesce(sum(l.quantity_litres), 0)
    into v_sent
    from public.trip_loadings l
    join public.tanker_trips t on t.id = l.trip_id and t.status <> 'cancelled'
   where l.bmc_id = old.bmc_id;

  if v_collected < v_sent then
    raise exception 'Cannot reduce this entry: % L of this BMC''s milk is already on tankers but only % L would remain collected. Reduce the dispatch first.',
      round(v_sent, 1), round(v_collected, 1) using errcode = 'P0001';
  end if;
  return null;
end;
$$;

create trigger milk_entries_guard_collected
  after update or delete on public.milk_entries
  for each row execute function public.guard_collected_not_below_dispatched();

-- backend-only tables: RLS on, no policies (the service role bypasses it)
alter table public.zone_settings enable row level security;
alter table public.selling_rate_history enable row level security;
alter table public.audit_logs enable row level security;
alter table public.correction_requests enable row level security;
alter table public.rate_charts enable row level security;
alter table public.rate_chart_cells enable row level security;
