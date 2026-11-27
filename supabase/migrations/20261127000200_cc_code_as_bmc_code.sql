-- The CC code is now the BMC code. Keep the old code for reference, then switch.
alter table public.bmcs add column if not exists legacy_bmc_code text;
update public.bmcs set legacy_bmc_code = bmc_code where legacy_bmc_code is null and cc_code is not null;
update public.bmcs set bmc_code = cc_code::text where cc_code is not null and bmc_code is distinct from cc_code::text;
