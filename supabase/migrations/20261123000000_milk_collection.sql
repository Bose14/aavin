-- ============================================================================
-- AAVIN: BMC milk collection by society
--
--   societies               the local societies / clusters a BMC collects from
--   milk_collection_lines   one row per society per shift entry
--   milk_entries            stays the per-shift roll-up (litres, weighted fat/snf,
--                           weighted rate) so analytics, records and valuation
--                           keep working; gains dispatch_date and cans.
--   save_milk_collection()  one atomic call that writes the entry and its lines
-- ============================================================================

create table public.societies (
  id          bigint generated always as identity primary key,
  id_token    text not null unique check (id_token ~ '^[A-Z]{2}00[A-Z]{4}[0-9]{3}$'),
  bmc_id      bigint not null references public.bmcs (id) on delete cascade,
  code        text not null,
  name        text not null,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (bmc_id, code)
);
create index idx_societies_bmc on public.societies (bmc_id) where is_active;
create trigger societies_id_token before insert or update on public.societies
  for each row execute function public.set_id_token('SC');
create trigger societies_touch before update on public.societies
  for each row execute function public.touch_updated_at();
alter table public.societies enable row level security;

create table public.milk_collection_lines (
  id          bigint generated always as identity primary key,
  entry_id    bigint not null references public.milk_entries (id) on delete cascade,
  society_id  bigint not null references public.societies (id),
  cans        integer not null default 0 check (cans >= 0),
  litres      numeric(10, 2) not null check (litres > 0),
  fat_pct     numeric(5, 2) not null check (fat_pct >= 0 and fat_pct <= 15),
  snf_pct     numeric(5, 2) not null check (snf_pct >= 0 and snf_pct <= 15),
  lt_fat      numeric(10, 3) generated always as (round(litres * fat_pct / 100, 3)) stored,
  lt_snf      numeric(10, 3) generated always as (round(litres * snf_pct / 100, 3)) stored,
  rate        numeric(8, 2) not null default 0,
  amount      numeric(12, 2) not null default 0,
  created_at  timestamptz not null default now(),
  unique (entry_id, society_id)
);
create index idx_mcl_entry on public.milk_collection_lines (entry_id);
create index idx_mcl_society on public.milk_collection_lines (society_id);
alter table public.milk_collection_lines enable row level security;

alter table public.milk_entries
  add column dispatch_date date,
  add column cans integer;

-- p = { entry_id?, bmc_id, dairy_unit_id, date, shift, dispatch_date, temperature,
--       actor, selling_rate_applied, lines: [{society_id, cans, litres, fat_pct, snf_pct, rate, amount}] }
-- Creates the entry (or rewrites it when entry_id is given) and returns the entry id.
-- Litres, fat, snf and rate of the entry are derived from the lines.
create or replace function public.save_milk_collection(p jsonb)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_entry   bigint := nullif(p ->> 'entry_id', '')::bigint;
  v_bmc     bigint := (p ->> 'bmc_id')::bigint;
  v_lines   jsonb  := p -> 'lines';
  v_count   integer;
  v_valid   integer;
  v_litres  numeric;
  v_fat     numeric;
  v_snf     numeric;
  v_rate    numeric;
  v_cans    integer;
begin
  if v_lines is null or jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'Add at least one society with litres' using errcode = 'P0001';
  end if;

  select count(*), count(s.id)
    into v_count, v_valid
    from jsonb_to_recordset(v_lines) as l(society_id bigint)
    left join public.societies s on s.id = l.society_id and s.bmc_id = v_bmc and s.is_active;
  if v_count <> v_valid then
    raise exception 'A society does not belong to this BMC' using errcode = 'P0001';
  end if;
  if (select count(distinct society_id) from jsonb_to_recordset(v_lines) as l(society_id bigint)) <> v_count then
    raise exception 'A society is listed twice' using errcode = 'P0001';
  end if;

  select sum(litres), sum(litres * fat_pct) / sum(litres), sum(litres * snf_pct) / sum(litres),
         sum(amount) / sum(litres), coalesce(sum(cans), 0)
    into v_litres, v_fat, v_snf, v_rate, v_cans
    from jsonb_to_recordset(v_lines)
      as l(litres numeric, fat_pct numeric, snf_pct numeric, amount numeric, cans integer);

  if v_entry is null then
    insert into public.milk_entries
      (bmc_id, dairy_unit_id, date, shift, dispatch_date, temperature, fat_pct, snf_pct,
       quantity_litres, rejection_qty, rate_per_litre, rate_override, selling_rate_applied,
       cans, status, created_by)
    values
      (v_bmc, (p ->> 'dairy_unit_id')::bigint, (p ->> 'date')::date, p ->> 'shift',
       nullif(p ->> 'dispatch_date', '')::date, nullif(p ->> 'temperature', '')::numeric,
       round(v_fat, 2), round(v_snf, 2), round(v_litres, 2), 0, round(v_rate, 2), false,
       nullif(p ->> 'selling_rate_applied', '')::numeric, v_cans, 'submitted',
       nullif(p ->> 'actor', '')::uuid)
    returning id into v_entry;
  else
    update public.milk_entries set
      dispatch_date = nullif(p ->> 'dispatch_date', '')::date,
      temperature = nullif(p ->> 'temperature', '')::numeric,
      fat_pct = round(v_fat, 2), snf_pct = round(v_snf, 2),
      quantity_litres = round(v_litres, 2), rejection_qty = 0, rejection_reason = null,
      rate_per_litre = round(v_rate, 2), rate_override = false, rate_override_reason = null,
      cans = v_cans, updated_by = nullif(p ->> 'actor', '')::uuid
    where id = v_entry and bmc_id = v_bmc;
    if not found then
      raise exception 'Entry not found' using errcode = 'P0001';
    end if;
    delete from public.milk_collection_lines where entry_id = v_entry;
  end if;

  insert into public.milk_collection_lines (entry_id, society_id, cans, litres, fat_pct, snf_pct, rate, amount)
  select v_entry, l.society_id, coalesce(l.cans, 0), l.litres, l.fat_pct, l.snf_pct,
         coalesce(l.rate, 0), coalesce(l.amount, 0)
    from jsonb_to_recordset(v_lines)
      as l(society_id bigint, cans integer, litres numeric, fat_pct numeric, snf_pct numeric, rate numeric, amount numeric);

  return v_entry;
end;
$$;
