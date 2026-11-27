-- The browser loads the signed-in user's own profile directly (AuthContext). Row Level Security
-- policies already limit which rows each user can see; these grants are read-only and cover only
-- the four tables that profile query touches.
grant select on public.users, public.teams, public.dairy_units, public.bmcs to authenticated;
