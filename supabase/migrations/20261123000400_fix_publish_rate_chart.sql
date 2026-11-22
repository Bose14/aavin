-- publish_rate_chart: the insert used generate_series aliases named like the loop variable
create or replace function public.publish_rate_chart(p jsonb)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_id    bigint;
  v_type  text  := upper(coalesce(p ->> 'milk_type', ''));
  v_fats  jsonb := p -> 'fat_values';
  v_snfs  jsonb := p -> 'snf_values';
  v_rates jsonb := p -> 'rates';
  nf      integer;
  ns      integer;
  i       integer;
begin
  if v_type not in ('COW', 'BUFFALO') then
    raise exception 'Milk type must be COW or BUFFALO' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_fats) <> 'array' or jsonb_typeof(v_snfs) <> 'array' or jsonb_typeof(v_rates) <> 'array' then
    raise exception 'Rate chart is not in the expected shape' using errcode = 'P0001';
  end if;
  nf := jsonb_array_length(v_fats);
  ns := jsonb_array_length(v_snfs);
  if nf = 0 or ns = 0 or jsonb_array_length(v_rates) <> nf then
    raise exception 'Rate chart needs at least one fat row and one SNF column, with a rate for each' using errcode = 'P0001';
  end if;
  for i in 0 .. nf - 1 loop
    if jsonb_typeof(v_rates -> i) <> 'array' or jsonb_array_length(v_rates -> i) <> ns then
      raise exception 'Fat row % does not have a rate for every SNF column', v_fats ->> i using errcode = 'P0001';
    end if;
  end loop;

  insert into public.rate_charts (dairy_unit_id, milk_type, effective_from, name, created_by)
  values ((p ->> 'dairy_unit_id')::bigint, v_type, (p ->> 'effective_from')::date,
          nullif(p ->> 'name', ''), nullif(p ->> 'created_by', ''))
  returning id into v_id;

  insert into public.rate_chart_cells (chart_id, fat, snf, rate)
  select v_id, (v_fats ->> gi)::numeric, (v_snfs ->> gj)::numeric, (v_rates -> gi ->> gj)::numeric
    from generate_series(0, nf - 1) gi, generate_series(0, ns - 1) gj;

  return v_id;
end;
$$;
