-- Cover foreign keys flagged by the Supabase performance advisor
create index if not exists idx_correction_requests_bmc_id        on public.correction_requests (bmc_id);
create index if not exists idx_correction_requests_milk_entry_id on public.correction_requests (milk_entry_id);
create index if not exists idx_milk_entries_created_by           on public.milk_entries (created_by);
create index if not exists idx_milk_entries_updated_by           on public.milk_entries (updated_by);
create index if not exists idx_milk_entries_verified_by          on public.milk_entries (verified_by);
create index if not exists idx_tanker_trips_created_by           on public.tanker_trips (created_by);
create index if not exists idx_trip_loadings_created_by          on public.trip_loadings (created_by);
create index if not exists idx_trip_stages_done_by               on public.trip_stages (done_by);
create index if not exists idx_users_team_id                     on public.users (team_id);
