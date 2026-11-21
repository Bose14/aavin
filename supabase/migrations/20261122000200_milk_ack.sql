-- Milk acknowledgement: what the dairy unit acknowledged for each BMC's dispatch on a tanker.
-- The BMC's invoice figures stay in trip_loadings; the acknowledged litres and fat/SNF per BMC
-- are decided at unloading/QC and stored here. Everything else in the report is calculated
-- in v_milk_ack with the same formulas as the Excel statement.

create table public.trip_acknowledgements (
  id             bigint generated always as identity primary key,
  id_token       text not null unique check (id_token ~ '^[A-Z]{2}00[A-Z]{4}[0-9]{3}$'),
  trip_id        bigint not null references public.tanker_trips (id) on delete cascade,
  bmc_id         bigint not null references public.bmcs (id),
  dc_number      text not null,
  ack_litres     numeric(10, 2) not null check (ack_litres >= 0),
  ack_fat_pct    numeric(8, 4)  not null check (ack_fat_pct >= 0 and ack_fat_pct <= 15),
  ack_snf_pct    numeric(8, 4)  not null check (ack_snf_pct >= 0 and ack_snf_pct <= 15),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (trip_id, bmc_id, dc_number)
);
create index idx_trip_ack_trip on public.trip_acknowledgements (trip_id);
create index idx_trip_ack_bmc  on public.trip_acknowledgements (bmc_id);
create trigger trip_ack_id_token before insert or update on public.trip_acknowledgements
  for each row execute function public.set_id_token('AK');
create trigger trip_ack_touch before update on public.trip_acknowledgements
  for each row execute function public.touch_updated_at();
alter table public.trip_acknowledgements enable row level security;

create or replace view public.v_milk_ack with (security_invoker = true) as
with inv as (
  select l.trip_id, l.bmc_id, l.dc_number,
         sum(l.quantity_litres)                                                         as inv_l,
         round(sum(l.quantity_litres * coalesce(l.fat_pct, 0)) / nullif(sum(l.quantity_litres), 0), 2) as inv_fat,
         round(sum(l.quantity_litres * coalesce(l.snf_pct, 0)) / nullif(sum(l.quantity_litres), 0), 2) as inv_snf,
         min(l.shift)       as shift,
         min(l.milk_type)   as milk_type,
         min(l.dispatch_at) as dispatch_at
    from public.trip_loadings l
   group by l.trip_id, l.bmc_id, l.dc_number
),
base as (
  select t.id as trip_id, t.dairy_unit_id, t.trip_date, i.shift, i.milk_type, i.dispatch_at,
         b.id as bmc_id, b.kind, b.route_name, b.team_name, b.code_no, b.bmc_code, b.name as bmc_name,
         coalesce(du.short_code, du.name) as dest, k.vehicle_number, i.dc_number,
         i.inv_l, i.inv_fat, i.inv_snf, a.ack_litres, a.ack_fat_pct as ack_fat, a.ack_snf_pct as ack_snf,
         sum(i.inv_l) over (partition by t.id) as trip_inv_l
    from inv i
    join public.tanker_trips t on t.id = i.trip_id and t.status <> 'cancelled'
    join public.tankers k on k.id = t.tanker_id
    join public.bmcs b on b.id = i.bmc_id
    join public.dairy_units du on du.id = t.dairy_unit_id
    join public.trip_acknowledgements a on a.trip_id = i.trip_id and a.bmc_id = i.bmc_id and a.dc_number = i.dc_number
),
sp as (
  select base.*,
         round(1 + (inv_snf - (inv_fat * 0.2 + 0.36)) / 250, 4) as inv_sp,
         round(1 + (ack_snf - (ack_fat * 0.2 + 0.36)) / 250, 4) as ack_sp
    from base
),
c as (
  select sp.*,
         inv_l * inv_fat / 100 as inv_lit_fat,
         inv_l * inv_snf / 100 as inv_lit_snf,
         inv_l * inv_sp        as inv_kg,
         round(inv_sp * inv_fat * inv_l / 100, 3) as inv_kg_fat,
         round(inv_sp * inv_snf * inv_l / 100, 3) as inv_kg_snf,
         ack_litres * ack_fat / 100 as ack_lit_fat,
         ack_litres * ack_snf / 100 as ack_lit_snf,
         ack_litres * ack_sp        as ack_kg,
         round(ack_sp * ack_fat * ack_litres / 100, 3) as ack_kg_fat,
         round(ack_sp * ack_snf * ack_litres / 100, 3) as ack_kg_snf,
         inv_l / nullif(trip_inv_l, 0) * 30 as milk30_kg
    from sp
),
d as (
  select c.*,
         ack_litres - inv_l                       as qty_diff_lit,
         ack_kg_fat - inv_kg_fat                  as diff_fat_kg,
         ack_kg_snf - inv_kg_snf                  as diff_snf_kg,
         ack_lit_fat - inv_lit_fat                as fat_lit_diff,
         ack_lit_snf - inv_lit_snf                as snf_lit_diff,
         milk30_kg / nullif(inv_sp, 0)            as milk30_lit,
         inv_l * 0.032 / 100                      as norm_fat_032,
         inv_l * 0.032 / 100                      as norm_snf_032
    from c
),
e as (
  select d.*,
         milk30_lit * inv_fat / 100 as milk30_lit_fat,
         milk30_lit * inv_snf / 100 as milk30_lit_snf
    from d
),
f as (
  select e.*,
         milk30_lit_fat + norm_fat_032 as allowed_fat,
         milk30_lit_snf + norm_snf_032 as allowed_snf
    from e
),
g as (
  select f.*,
         allowed_fat + fat_lit_diff as above_fat,
         allowed_snf + snf_lit_diff as above_snf
    from f
)
select g.*,
       case when above_fat < 0 then above_fat else 0 end as net_loss_fat,
       case when above_snf < 0 then above_snf else 0 end as net_loss_snf
  from g;

notify pgrst, 'reload schema';
