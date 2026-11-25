-- ============================================================================
-- Security hardening + persistent gate pass numbering
-- ============================================================================

-- 1. v_milk_ack lost security_invoker when it was re-created; restore it so RLS applies.
alter view public.v_milk_ack set (security_invoker = true);

-- 2. The browser only uses Supabase Auth. All data goes through the backend with the
--    service-role key, so the public roles get no direct table/view/function access.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- 3. Gate pass number sequence (replaces the on-disk counter that reset on every deploy).
create sequence if not exists public.gate_pass_no_seq start 1;
revoke all on sequence public.gate_pass_no_seq from anon, authenticated;

create or replace function public.next_gate_pass_no() returns text
language sql security definer set search_path = public as
$$ select lpad(nextval('public.gate_pass_no_seq')::text, 6, '0') $$;
revoke all on function public.next_gate_pass_no() from public, anon, authenticated;
grant execute on function public.next_gate_pass_no() to service_role;
