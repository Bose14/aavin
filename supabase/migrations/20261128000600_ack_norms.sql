-- Allowed-loss norms used by the Milk Ack and BMC DMR Loss reports, configurable per dairy unit.
-- A norm applies from its effective date until the next one. pct is a percentage (0.032 = 0.032%).
create table if not exists public.ack_norms (
  id bigint generated always as identity primary key,
  dairy_unit_id bigint not null references public.dairy_units (id),
  effective_from date not null,
  kg_per_tanker numeric(10,3) not null check (kg_per_tanker >= 0),
  pct numeric(8,5) not null check (pct >= 0),
  created_at timestamptz not null default now(),
  unique (dairy_unit_id, effective_from)
);
alter table public.ack_norms enable row level security; -- backend (service role) only

insert into public.ack_norms (dairy_unit_id, effective_from, kg_per_tanker, pct)
select id, date '2000-01-01', 30, 0.032 from public.dairy_units
on conflict (dairy_unit_id, effective_from) do nothing;
