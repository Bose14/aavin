-- Imported historical BMC receipts (AM / PM collected and litres loaded per BMC per day).
-- The BMC Receipts report uses live milk entries and tanker loadings where they exist and
-- falls back to this table for older months. Server-only: no browser access.
create table if not exists public.bmc_receipt_history (
  id              bigint generated always as identity primary key,
  dairy_unit_id   bigint not null references public.dairy_units(id) on delete cascade,
  bmc_id          bigint not null references public.bmcs(id) on delete cascade,
  receipt_date    date   not null,
  am_litres       numeric(12,2) not null default 0,
  pm_litres       numeric(12,2) not null default 0,
  loaded_litres   numeric(12,2) not null default 0,
  opening_litres  numeric(12,2),            -- only needed for the first day of a series
  created_at      timestamptz not null default now(),
  unique (bmc_id, receipt_date)
);
create index if not exists bmc_receipt_history_unit_date_idx on public.bmc_receipt_history (dairy_unit_id, receipt_date);
alter table public.bmc_receipt_history enable row level security;
revoke all on public.bmc_receipt_history from anon, authenticated;
