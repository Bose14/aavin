-- Milk entry is one row per BMC / date / shift: societies and society-wise lines are gone.
-- milk_entries already holds the shift roll-up (litres, fat, snf, rate, dispatch_date), so it is untouched.
drop function if exists public.save_milk_collection(jsonb);
drop table if exists public.milk_collection_lines;
drop table if exists public.societies;
alter table public.milk_entries drop column if exists cans;
