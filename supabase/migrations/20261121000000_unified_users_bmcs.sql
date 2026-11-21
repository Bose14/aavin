-- ============================================================================
-- AAVIN: unified users, teams and BMCs
--
-- * Every table has  id        bigint identity (1, 2, 3 ...)  -> internal joins
--                    id_token  text, e.g. US00ASCF123          -> public identifier
-- * ONE users table. Each user belongs to a team (teams.id); BMC users also
--   have a bmc_id. The role is derived from the team.
-- * units  -> bmcs, unit_id -> bmc_id, unit_code -> bmc_code
-- * Existing zones, BMCs, logins, milk entries and dispatches are carried over.
-- * No seed data, except the 5 fixed teams the application cannot run without.
--
-- Scope: zones, teams, bmcs, users, milk_entries, tanker_dispatches.
-- registered_tankers and the tanker journey tables are redesigned separately.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. id_token generator:  <2 letters> + '00' + <4 capitals> + <3 digits>
-- ---------------------------------------------------------------------------
create or replace function public.gen_id_token(prefix text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  letters constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  token text := prefix || '00';
  i int;
begin
  for i in 1..4 loop
    token := token || substr(letters, 1 + floor(random() * 26)::int, 1);
  end loop;
  for i in 1..3 loop
    token := token || floor(random() * 10)::int::text;
  end loop;
  return token;
end;
$$;

-- Fills id_token on insert (retrying on the rare clash) and makes it immutable.
create or replace function public.set_id_token()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  candidate text;
  taken boolean;
  tries int := 0;
begin
  if tg_op = 'UPDATE' then
    new.id_token := old.id_token;
    return new;
  end if;

  if new.id_token is not null then
    return new;
  end if;

  loop
    candidate := public.gen_id_token(tg_argv[0]);
    execute format('select exists (select 1 from %I.%I where id_token = $1)', tg_table_schema, tg_table_name)
      into taken using candidate;
    exit when not taken;
    tries := tries + 1;
    if tries > 25 then
      raise exception 'could not generate a unique id_token for %', tg_table_name;
    end if;
  end loop;

  new.id_token := candidate;
  return new;
end;
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Move the old tables out of the way
-- ---------------------------------------------------------------------------
alter table public.tanker_dispatches rename to _old_tanker_dispatches;
alter table public.milk_entries      rename to _old_milk_entries;
alter table public.profiles          rename to _old_profiles;
alter table public.units             rename to _old_units;
alter table public.zones             rename to _old_zones;

-- ---------------------------------------------------------------------------
-- 3. zones
-- ---------------------------------------------------------------------------
create table public.zones (
  id         bigint generated always as identity primary key,
  id_token   text not null unique check (id_token ~ '^[A-Z]{2}00[A-Z]{4}[0-9]{3}$'),
  name       text not null unique,
  created_at timestamptz not null default now()
);
create trigger zones_id_token before insert or update on public.zones
  for each row execute function public.set_id_token('ZN');

-- ---------------------------------------------------------------------------
-- 4. teams (fixed reference rows, not seed data)
-- ---------------------------------------------------------------------------
create table public.teams (
  id         bigint generated always as identity primary key,
  id_token   text not null unique check (id_token ~ '^[A-Z]{2}00[A-Z]{4}[0-9]{3}$'),
  code       text not null unique check (code in ('ADMIN', 'GATE', 'QC', 'UNLOADING', 'BMC')),
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create trigger teams_id_token before insert or update on public.teams
  for each row execute function public.set_id_token('TM');

insert into public.teams (code, name) values
  ('ADMIN',     'Administration'),
  ('GATE',      'Gate Operations Team'),
  ('QC',        'Quality Control (QC) Team'),
  ('UNLOADING', 'Milk Unloading Team'),
  ('BMC',       'BMC (Bulk Milk Cooler) Staff');

-- ---------------------------------------------------------------------------
-- 5. bmcs (was units)
-- ---------------------------------------------------------------------------
create table public.bmcs (
  id         bigint generated always as identity primary key,
  id_token   text not null unique check (id_token ~ '^[A-Z]{2}00[A-Z]{4}[0-9]{3}$'),
  zone_id    bigint not null references public.zones (id),
  name       text not null,
  location   text,
  bmc_code   text not null unique,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_bmcs_zone on public.bmcs (zone_id);
create trigger bmcs_id_token before insert or update on public.bmcs
  for each row execute function public.set_id_token('BM');
create trigger bmcs_touch before update on public.bmcs
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 6. users (was profiles): ONE table for everyone
-- ---------------------------------------------------------------------------
create table public.users (
  id                   bigint generated always as identity primary key,
  id_token             text not null unique check (id_token ~ '^[A-Z]{2}00[A-Z]{4}[0-9]{3}$'),
  auth_user_id         uuid not null unique references auth.users (id) on delete cascade,
  zone_id              bigint not null references public.zones (id),
  team_id              bigint not null references public.teams (id),
  bmc_id               bigint references public.bmcs (id),
  full_name            text not null,
  email                text not null,
  phone                text,
  shift                text not null default 'General' check (shift in ('Morning', 'Evening', 'General')),
  sub_role             text not null default 'operator' check (sub_role in ('operator', 'supervisor')),
  is_active            boolean not null default true,
  must_change_password boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index uq_users_email on public.users (lower(email));
create index idx_users_zone_team on public.users (zone_id, team_id);
create index idx_users_bmc on public.users (bmc_id) where bmc_id is not null;
create trigger users_id_token before insert or update on public.users
  for each row execute function public.set_id_token('US');
create trigger users_touch before update on public.users
  for each row execute function public.touch_updated_at();

-- A BMC user must have a BMC in their own zone; everyone else must not have one.
create or replace function public.validate_user_bmc()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  team_code text;
  bmc_zone  bigint;
begin
  select code into team_code from public.teams where id = new.team_id;

  if team_code = 'BMC' then
    if new.bmc_id is null then
      raise exception 'A BMC user must have a bmc_id';
    end if;
    select zone_id into bmc_zone from public.bmcs where id = new.bmc_id;
    if bmc_zone is distinct from new.zone_id then
      raise exception 'The BMC must belong to the same zone as the user';
    end if;
  elsif new.bmc_id is not null then
    raise exception 'Only BMC team users can have a bmc_id';
  end if;

  return new;
end;
$$;
create trigger users_validate_bmc before insert or update of team_id, bmc_id, zone_id on public.users
  for each row execute function public.validate_user_bmc();

-- ---------------------------------------------------------------------------
-- 7. milk_entries
-- ---------------------------------------------------------------------------
create table public.milk_entries (
  id                   bigint generated always as identity primary key,
  id_token             text not null unique check (id_token ~ '^[A-Z]{2}00[A-Z]{4}[0-9]{3}$'),
  bmc_id               bigint not null references public.bmcs (id),
  zone_id              bigint not null references public.zones (id),
  date                 date not null,
  shift                text not null check (shift in ('AM', 'PM')),
  fat_pct              numeric(5, 2) not null check (fat_pct >= 0 and fat_pct <= 15),
  snf_pct              numeric(5, 2) not null check (snf_pct >= 0 and snf_pct <= 15),
  quantity_litres      numeric(10, 2) not null check (quantity_litres >= 0),
  rejection_qty        numeric(10, 2) not null default 0 check (rejection_qty >= 0),
  rejection_reason     text,
  temperature          numeric(5, 1),
  rate_per_litre       numeric(6, 2) not null,
  rate_override        boolean not null default false,
  rate_override_reason text,
  selling_rate_applied numeric(6, 2),
  status               text not null default 'submitted',
  verified_by          uuid references auth.users (id),
  verified_at          timestamptz,
  created_by           uuid references auth.users (id),
  updated_by           uuid references auth.users (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (bmc_id, date, shift)
);
create index idx_milk_entries_zone_date on public.milk_entries (zone_id, date desc);
create index idx_milk_entries_bmc_date  on public.milk_entries (bmc_id, date desc);
create trigger milk_entries_id_token before insert or update on public.milk_entries
  for each row execute function public.set_id_token('ML');
create trigger milk_entries_touch before update on public.milk_entries
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 8. tanker_dispatches (same columns as today; full redesign is the next step)
-- ---------------------------------------------------------------------------
create table public.tanker_dispatches (
  id                  bigint generated always as identity primary key,
  id_token            text not null unique check (id_token ~ '^[A-Z]{2}00[A-Z]{4}[0-9]{3}$'),
  bmc_id              bigint not null references public.bmcs (id),
  zone_id             bigint not null references public.zones (id),
  date                date not null,
  tanker_number       text not null,
  quantity_dispatched numeric(10, 2) not null check (quantity_dispatched >= 0),
  destination         text,
  created_by          uuid references auth.users (id),
  created_at          timestamptz not null default now()
);
create index idx_tanker_dispatches_zone_date on public.tanker_dispatches (zone_id, date desc);
create index idx_tanker_dispatches_bmc_date  on public.tanker_dispatches (bmc_id, date desc);
create index idx_tanker_dispatches_number    on public.tanker_dispatches (tanker_number);
create trigger tanker_dispatches_id_token before insert or update on public.tanker_dispatches
  for each row execute function public.set_id_token('TD');

-- ---------------------------------------------------------------------------
-- 9. Carry the existing data forward
-- ---------------------------------------------------------------------------
insert into public.zones (name, created_at)
select name, created_at from public._old_zones order by created_at, name;

insert into public.bmcs (zone_id, name, location, bmc_code, is_active, created_at)
select nz.id, ou.name, ou.location, ou.unit_code, coalesce(ou.is_active, true), coalesce(ou.created_at, now())
from public._old_units ou
join public._old_zones oz on oz.id = ou.zone_id
join public.zones nz on nz.name = oz.name
order by ou.created_at;

-- Users: the team comes from the BMC link, else the team saved in the login
-- metadata (plant users were stored as role 'unit' before), else the admin role.
-- The old superadmin (no zone) becomes an ADMIN of the same zone as the existing admin.
insert into public.users
  (auth_user_id, zone_id, team_id, bmc_id, full_name, email, phone, shift, sub_role,
   is_active, must_change_password, created_at)
select
  p.id,
  coalesce(
    nz.id,
    (select z2.id
       from public._old_profiles a
       join public._old_zones oz2 on oz2.id = a.zone_id
       join public.zones z2 on z2.name = oz2.name
      where a.role = 'admin' and a.zone_id is not null
      order by a.created_at limit 1)
  ),
  t.id,
  nb.id,
  coalesce(nullif(trim(p.full_name), ''), split_part(au.email, '@', 1)),
  lower(au.email),
  nullif(trim(p.phone), ''),
  case when au.raw_user_meta_data ->> 'shift' in ('Morning', 'Evening', 'General')
       then au.raw_user_meta_data ->> 'shift' else 'General' end,
  case when au.raw_user_meta_data ->> 'sub_role' = 'supervisor' then 'supervisor' else 'operator' end,
  coalesce((au.raw_user_meta_data ->> 'is_active')::boolean, true),
  coalesce((au.raw_user_meta_data ->> 'must_change_password')::boolean, false),
  coalesce(p.created_at, now())
from public._old_profiles p
join auth.users au on au.id = p.id
left join public._old_zones oz on oz.id = p.zone_id
left join public.zones nz on nz.name = oz.name
left join public._old_units ou on ou.id = p.unit_id
left join public.bmcs nb on nb.bmc_code = ou.unit_code
join public.teams t on t.code = case
    when p.unit_id is not null then 'BMC'
    when upper(au.raw_user_meta_data ->> 'team') in ('GATE', 'QC', 'UNLOADING')
         then upper(au.raw_user_meta_data ->> 'team')
    when p.role in ('admin', 'superadmin') then 'ADMIN'
  end
order by p.created_at;

-- A phone number can belong to one user per zone. Existing duplicates keep the
-- number on the earliest user only (the later user's phone is cleared).
update public.users u
   set phone = null
 where u.phone is not null
   and exists (select 1 from public.users o
                where o.zone_id = u.zone_id and o.phone = u.phone and o.id < u.id);
create unique index uq_users_zone_phone on public.users (zone_id, phone) where phone is not null;

insert into public.milk_entries
  (bmc_id, zone_id, date, shift, fat_pct, snf_pct, quantity_litres, rejection_qty, temperature,
   rate_per_litre, created_by, created_at)
select nb.id, nz.id, m.date, m.shift, m.fat_pct, m.snf_pct, m.quantity_litres,
       coalesce(m.rejection_qty, 0), m.temperature, m.rate_per_litre, m.created_by,
       coalesce(m.created_at, now())
from public._old_milk_entries m
join public._old_units ou on ou.id = m.unit_id
join public.bmcs nb on nb.bmc_code = ou.unit_code
join public._old_zones oz on oz.id = m.zone_id
join public.zones nz on nz.name = oz.name
order by m.created_at;

insert into public.tanker_dispatches
  (bmc_id, zone_id, date, tanker_number, quantity_dispatched, destination, created_by, created_at)
select nb.id, nz.id, d.date, d.tanker_number, d.quantity_dispatched, d.destination, d.created_by,
       coalesce(d.created_at, now())
from public._old_tanker_dispatches d
join public._old_units ou on ou.id = d.unit_id
join public.bmcs nb on nb.bmc_code = ou.unit_code
join public._old_zones oz on oz.id = d.zone_id
join public.zones nz on nz.name = oz.name
order by d.created_at;

-- ---------------------------------------------------------------------------
-- 10. Drop the old structures
-- ---------------------------------------------------------------------------
drop table public._old_tanker_dispatches;
drop table public._old_milk_entries;
drop table public._old_profiles;
drop table public._old_units;
drop table public._old_zones;

drop function if exists public.auth_role();
drop function if exists public.auth_zone_id();
drop function if exists public.auth_unit_id();

-- ---------------------------------------------------------------------------
-- 11. Row level security
-- The backend uses the service-role key (bypasses RLS). The browser only reads
-- its own user row, its zone and its BMCs through the anon/authenticated key.
-- ---------------------------------------------------------------------------
alter table public.zones             enable row level security;
alter table public.teams             enable row level security;
alter table public.bmcs              enable row level security;
alter table public.users             enable row level security;
alter table public.milk_entries      enable row level security;
alter table public.tanker_dispatches enable row level security;

create policy users_read_own on public.users
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

create policy zones_read on public.zones
  for select to authenticated
  using (true);

create policy teams_read on public.teams
  for select to authenticated
  using (true);

create policy bmcs_read_own_zone on public.bmcs
  for select to authenticated
  using (zone_id = (select u.zone_id from public.users u where u.auth_user_id = (select auth.uid())));

notify pgrst, 'reload schema';
