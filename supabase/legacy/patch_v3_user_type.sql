-- ====================================================================
-- PATCH v3: Add user_type column to profiles
-- Distinguishes internal plant operators from BMC unit staff
-- Values: 'internal' (Gate/QC/Unloading) | 'bmc' (BMC unit staff)
-- ====================================================================

alter table profiles add column if not exists user_type text default 'internal';

alter table profiles drop constraint if exists profiles_user_type_check;
alter table profiles add constraint profiles_user_type_check
  check (user_type in ('internal', 'bmc'));

-- Back-fill existing rows
update profiles set user_type = 'bmc'
  where role = 'unit' and (user_type is null or user_type = 'internal');

update profiles set user_type = 'internal'
  where role in ('gate', 'qc', 'unloading', 'GATE', 'QC', 'UNLOADING', 'admin', 'superadmin')
  and (user_type is null);

notify pgrst, 'reload schema';
