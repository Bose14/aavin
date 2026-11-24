-- Milk entry is one row per BMC / date / shift: societies and society-wise lines are gone.
-- Existing milk_entries rows are kept (tanker dispatches depend on them); they already hold
-- the shift totals, so only the missing dispatch date is filled (AM = same day, PM = next day).
update public.milk_entries
   set dispatch_date = case when shift = 'PM' then date + 1 else date end
 where dispatch_date is null;
drop function if exists public.save_milk_collection(jsonb);
drop table if exists public.milk_collection_lines;
drop table if exists public.societies;
alter table public.milk_entries drop column if exists cans;
