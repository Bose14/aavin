-- ============================================================================
-- AAVIN: zones -> dairy_units
--  * table  zones            -> dairy_units   (+ short_code, e.g. ND / AMB / SNR / CBE / MDU)
--  * column zone_id          -> dairy_unit_id (bmcs, users, milk_entries, tanker_dispatches)
--  * id_token prefix ZN      -> DU            (existing rows rewritten, new rows use DU)
--  * bmcs gain the fields the Milk Acknowledgement report needs:
--      route_name, team_name, kind (BMC / CC) and code_no (numeric report code)
-- ============================================================================

alter table public.zones rename to dairy_units;
alter table public.dairy_units add column short_code text;
create unique index uq_dairy_units_short_code on public.dairy_units (upper(short_code)) where short_code is not null;

-- id_token prefix ZN -> DU (the trigger makes id_token immutable, so swap it out first)
drop trigger zones_id_token on public.dairy_units;
update public.dairy_units set id_token = 'DU' || substr(id_token, 3);
create trigger dairy_units_id_token before insert or update on public.dairy_units
  for each row execute function public.set_id_token('DU');

alter table public.bmcs              rename column zone_id to dairy_unit_id;
alter table public.users             rename column zone_id to dairy_unit_id;
alter table public.milk_entries      rename column zone_id to dairy_unit_id;
alter table public.tanker_dispatches rename column zone_id to dairy_unit_id;

alter index public.idx_bmcs_zone                   rename to idx_bmcs_dairy_unit;
alter index public.idx_users_zone_team             rename to idx_users_dairy_unit_team;
alter index public.uq_users_zone_phone             rename to uq_users_dairy_unit_phone;
alter index public.idx_milk_entries_zone_date      rename to idx_milk_entries_dairy_unit_date;
alter index public.idx_tanker_dispatches_zone_date rename to idx_tanker_dispatches_dairy_unit_date;

alter policy zones_read          on public.dairy_units rename to dairy_units_read;
alter policy bmcs_read_own_zone  on public.bmcs        rename to bmcs_read_own_dairy_unit;

-- trigger function body refers to the column by name, so recreate it
create or replace function public.validate_user_bmc()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  team_code text;
  bmc_unit  bigint;
begin
  select code into team_code from public.teams where id = new.team_id;

  if team_code = 'BMC' then
    if new.bmc_id is null then
      raise exception 'A BMC user must have a bmc_id';
    end if;
    select dairy_unit_id into bmc_unit from public.bmcs where id = new.bmc_id;
    if bmc_unit is distinct from new.dairy_unit_id then
      raise exception 'The BMC must belong to the same dairy unit as the user';
    end if;
  elsif new.bmc_id is not null then
    raise exception 'Only BMC team users can have a bmc_id';
  end if;

  return new;
end;
$$;

-- report fields on bmcs
alter table public.bmcs
  add column route_name text,
  add column team_name  text,
  add column kind       text not null default 'BMC' check (kind in ('BMC', 'CC')),
  add column code_no    integer;
create unique index uq_bmcs_dairy_unit_code_no on public.bmcs (dairy_unit_id, code_no) where code_no is not null;

notify pgrst, 'reload schema';
