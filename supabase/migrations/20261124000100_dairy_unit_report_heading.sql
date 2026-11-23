alter table public.dairy_units add column if not exists report_title text, add column if not exists report_address text;
comment on column public.dairy_units.report_title is 'Heading printed on union reports; defaults to "<NAME> DISTRICT COOPERATIVE MILK PRODUCERS'' UNION LTD." when empty';
comment on column public.dairy_units.report_address is 'Address line printed under the heading on union reports';
