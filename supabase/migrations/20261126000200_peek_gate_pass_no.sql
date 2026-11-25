-- Preview of the next gate pass number without consuming it
create or replace function public.peek_gate_pass_no() returns text
language sql security definer set search_path = public as
$$ select lpad((case when is_called then last_value + 1 else last_value end)::text, 6, '0')
   from public.gate_pass_no_seq $$;
revoke all on function public.peek_gate_pass_no() from public, anon, authenticated;
grant execute on function public.peek_gate_pass_no() to service_role;
