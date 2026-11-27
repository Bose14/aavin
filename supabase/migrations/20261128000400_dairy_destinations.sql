-- Destinations a dairy unit sends milk to (e.g. Namakkal: SNR, ND, CBE). Each dairy unit has its own list.
-- A tanker is registered with a destination; every trip keeps its own copy so later changes to the
-- tanker do not rewrite past trips. Server-only: no browser access.
create table if not exists public.dairy_destinations (
  id            bigint generated always as identity primary key,
  dairy_unit_id bigint not null references public.dairy_units(id) on delete cascade,
  code          text   not null,
  name          text   not null,
  sort_order    int    not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (dairy_unit_id, code)
);
alter table public.dairy_destinations enable row level security;
revoke all on public.dairy_destinations from anon, authenticated;

insert into public.dairy_destinations (dairy_unit_id, code, name, sort_order)
select u.id, v.code, v.name, v.ord
from public.dairy_units u
cross join (values ('SNR', 'Sholinganallur', 1), ('ND', 'Namakkal Dairy', 2), ('CBE', 'Coimbatore', 3)) as v(code, name, ord)
where u.name = 'Namakkal'
on conflict (dairy_unit_id, code) do nothing;

alter table public.tankers      add column if not exists destination_id bigint references public.dairy_destinations(id);
alter table public.tanker_trips add column if not exists destination_id bigint references public.dairy_destinations(id);

-- A new trip starts with the tanker's destination.
create or replace function public.set_trip_destination() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.destination_id is null then
    select t.destination_id into new.destination_id from public.tankers t where t.id = new.tanker_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_trip_destination on public.tanker_trips;
create trigger trg_trip_destination before insert on public.tanker_trips
  for each row execute function public.set_trip_destination();
