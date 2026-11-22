-- Tanker route name (e.g. "Rasipuram Route 1"), entered at registration and shown as
-- "NAME OF THE ROUTE" in the Milk ACK report. A BMC's own route_name is the fallback.
alter table public.tankers add column route_name text;

do $$
declare
  d text := pg_get_viewdef('public.v_milk_ack'::regclass, true);
  n text;
begin
  n := replace(d, E'b.route_name,', E'COALESCE(k.route_name, b.route_name) AS route_name,');
  if n = d then
    raise exception 'v_milk_ack: route_name column not found, view left unchanged';
  end if;
  execute 'create or replace view public.v_milk_ack as ' || rtrim(n, E';\n ');
end $$;
