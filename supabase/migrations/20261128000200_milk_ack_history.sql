-- Imported historical Milk Disposal & Acknowledgement rows (one per BMC/CC invoice on a tanker).
-- The Milk Ack report uses live tanker loadings + acknowledgements where they exist for a date
-- and falls back to this table for older months. Plain text snapshot of the BMC/route details so
-- it survives renames. Server-only: no browser access.
create table if not exists public.milk_ack_history (
  id             bigint generated always as identity primary key,
  dairy_unit_id  bigint not null references public.dairy_units(id) on delete cascade,
  ack_date       date   not null,
  seq            integer not null,           -- order of the row inside the day, as in the sheet
  shift          text   not null default '',
  kind           text   not null default 'BMC',
  route          text   not null default '',
  milk_type      text   not null default 'RCM',
  team           text   not null default '',
  bmc_code       integer,
  bmc_name       text   not null default '',
  dest           text   not null default '',
  tanker         text   not null default '',
  inv_no         text   not null default '',
  qty_litres     numeric(12,2) not null,
  fat_pct        numeric(6,2)  not null default 0,
  snf_pct        numeric(6,2)  not null default 0,
  ack_litres     numeric(12,2),
  ack_fat_pct    numeric(6,2),
  ack_snf_pct    numeric(6,2),
  created_at     timestamptz not null default now(),
  unique (dairy_unit_id, ack_date, seq)
);
create index if not exists milk_ack_history_unit_date_idx on public.milk_ack_history (dairy_unit_id, ack_date);
alter table public.milk_ack_history enable row level security;
revoke all on public.milk_ack_history from anon, authenticated;
