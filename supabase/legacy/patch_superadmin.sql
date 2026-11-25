-- ============================================================
-- PATCH: Add superadmin role
-- Run this in Supabase SQL Editor AFTER the main schema.sql
-- ============================================================

-- 1. Update role constraint to include superadmin
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('superadmin', 'admin', 'unit'));

-- 2. Update RLS helper function (superadmin bypasses zone isolation)
-- Milk entries: superadmin can see all
DROP POLICY IF EXISTS "milk_unit_rw" ON milk_entries;
CREATE POLICY "milk_unit_rw" ON milk_entries FOR ALL
  USING (
    auth_role() = 'superadmin'
    OR (auth_role() = 'unit' AND unit_id = auth_unit_id())
    OR (auth_role() = 'admin' AND zone_id = auth_zone_id())
  )
  WITH CHECK (
    auth_role() = 'superadmin'
    OR (auth_role() = 'unit' AND unit_id = auth_unit_id() AND zone_id = auth_zone_id())
    OR (auth_role() = 'admin' AND zone_id = auth_zone_id())
  );

-- Tanker dispatches: same
DROP POLICY IF EXISTS "tanker_unit_rw" ON tanker_dispatches;
CREATE POLICY "tanker_unit_rw" ON tanker_dispatches FOR ALL
  USING (
    auth_role() = 'superadmin'
    OR (auth_role() = 'unit' AND unit_id = auth_unit_id())
    OR (auth_role() = 'admin' AND zone_id = auth_zone_id())
  )
  WITH CHECK (
    auth_role() = 'superadmin'
    OR (auth_role() = 'unit' AND unit_id = auth_unit_id() AND zone_id = auth_zone_id())
    OR (auth_role() = 'admin' AND zone_id = auth_zone_id())
  );

-- Profiles: superadmin can read all
DROP POLICY IF EXISTS "profiles_admin_zone" ON profiles;
CREATE POLICY "profiles_admin_zone" ON profiles FOR SELECT
  USING (
    auth_role() = 'superadmin'
    OR (auth_role() = 'admin' AND zone_id = auth_zone_id())
  );

-- Units: superadmin can manage all
DROP POLICY IF EXISTS "units_admin_write" ON units;
DROP POLICY IF EXISTS "units_admin_update" ON units;
CREATE POLICY "units_write" ON units FOR INSERT
  WITH CHECK (auth_role() IN ('admin', 'superadmin'));
CREATE POLICY "units_update" ON units FOR UPDATE
  USING (auth_role() = 'superadmin' OR (auth_role() = 'admin' AND zone_id = auth_zone_id()));

-- ============================================================
-- CREATE YOUR FIRST SUPERADMIN
-- Replace the values below, then run ONLY this section
-- ============================================================

-- Step 1: Sign up at https://aavin-test.netlify.app/login
--         (use the signup link that still exists, or create via Supabase Auth dashboard)
-- Step 2: Get the user's UUID from Supabase → Authentication → Users
-- Step 3: Run this INSERT with the real UUID:

-- INSERT INTO profiles (id, role, zone_id, full_name)
-- VALUES (
--   'PASTE-USER-UUID-HERE',   -- from Supabase Auth → Users
--   'superadmin',
--   NULL,                     -- superadmin has no zone (sees all)
--   'Super Admin'
-- );
