-- BMC teams: a grouping label for BMCs inside a union (e.g. Namakkal union -> RPM, T.CODE, NKL).
-- Not the same thing as public.teams (the app's user roles: Gate, QC, Unloading ...).
-- Additive: new table + one nullable column on bmcs. Nothing existing changes.

create table if not exists public.bmc_teams (
  id            bigint generated always as identity primary key,
  id_token      text not null unique check (id_token ~ '^[A-Z]{2}00[A-Z]{4}[0-9]{3}$'),
  dairy_unit_id bigint not null references public.dairy_units (id),
  name          text not null,
  code          text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (dairy_unit_id, code)
);
create index if not exists idx_bmc_teams_unit on public.bmc_teams (dairy_unit_id);

drop trigger if exists bmc_teams_id_token on public.bmc_teams;
create trigger bmc_teams_id_token before insert or update on public.bmc_teams
  for each row execute function public.set_id_token('BT');
drop trigger if exists bmc_teams_touch on public.bmc_teams;
create trigger bmc_teams_touch before update on public.bmc_teams
  for each row execute function public.touch_updated_at();

alter table public.bmc_teams enable row level security; -- backend (service role) only, like the other tables

alter table public.bmcs add column if not exists bmc_team_id bigint references public.bmc_teams (id);
create index if not exists idx_bmcs_team on public.bmcs (bmc_team_id);

-- Namakkal union: 3 teams
insert into public.bmc_teams (dairy_unit_id, name, code)
select d.id, v.name, v.code
from public.dairy_units d
cross join (values ('Rasipuram', 'RPM'), ('Tiruchengode', 'T.CODE'), ('Namakkal', 'NKL')) as v(name, code)
where d.name = 'Namakkal'
on conflict (dairy_unit_id, code) do nothing;

-- Map each BMC to its team (names as stored in bmcs; from the Sep-2026 Milk ACK sheet)
with m(team_code, bmc_name) as (values
  ('RPM','Singalandapuram'),('RPM','Pillipakuttai'),('RPM','Kamarajnagar'),('RPM','Vadugam'),('RPM','T.kummbakottai'),
  ('RPM','R.pudupatti'),('RPM','Andikuttai'),('RPM','Vepplaikuttai'),('RPM','Thanner Pandal Kadu'),('RPM','Thimmanaickanpatty'),
  ('RPM','Udairpalayam'),('RPM','Moolapallipatty'),('RPM','Em Palayam'),('RPM','Vellakkalpatty'),('RPM','Ponparapippatty'),
  ('RPM','Koonavealam Patty Pudur'),('RPM','Veppanathampudur'),('RPM','Minnakkal'),('RPM','Malayampatty'),
  ('NKL','Vettukadu'),('NKL','Solakkadu'),('NKL','Balanagar'),('NKL','Thathaiyangerapatty'),('NKL','Selliyaeepalayam'),
  ('NKL','Akkiyampatty'),('NKL','Vagurampatty'),('NKL','Ariyur'),('NKL','Vaiyappamalai'),('NKL','Kuttamookenpatty'),('NKL','Tholur'),
  ('T.CODE','Mangalam'),('T.CODE','Kuttikapalayam'),('T.CODE','Selursellapampalayam'),('T.CODE','Pappampalayam'),('T.CODE','Thannerpanthalpalayam')
)
update public.bmcs b
   set bmc_team_id = t.id,
       team_name   = t.code            -- keeps the Milk ACK report's Team column in step
  from m
  join public.dairy_units d on d.name = 'Namakkal'
  join public.bmc_teams t on t.dairy_unit_id = d.id and t.code = m.team_code
 where b.dairy_unit_id = d.id and lower(b.name) = lower(m.bmc_name);

-- Test team: groups the test BMCs so no BMC is left without a team
insert into public.bmc_teams (dairy_unit_id, name, code)
select id, 'Test', 'TEST' from public.dairy_units where name = 'Namakkal'
on conflict (dairy_unit_id, code) do nothing;

update public.bmcs b
   set bmc_team_id = t.id, team_name = t.code
  from public.bmc_teams t
  join public.dairy_units d on d.id = t.dairy_unit_id
 where d.name = 'Namakkal' and t.code = 'TEST'
   and b.dairy_unit_id = d.id and b.bmc_team_id is null
   and b.bmc_code in ('RNK-001', 'BMC-002', 'SLM_001');
