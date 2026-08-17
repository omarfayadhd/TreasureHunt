create or replace function public.generate_routes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_final uuid;
  v_regular uuid[];
  v_n int;
  v_teams uuid[];
  v_team uuid;
  v_i int := 0;
  v_start uuid;
  v_rest uuid[];
  v_route uuid[];
  v_created int := 0;
begin
  perform assert_admin();
  select status into v_status from game where id = 1;

  select id into v_final from stations where is_final;
  if v_final is null then
    return jsonb_build_object('ok', false, 'error', 'no_final_station');
  end if;

  select coalesce(array_agg(id order by random()), '{}'::uuid[]) into v_regular
  from stations where not is_final;
  v_n := coalesce(array_length(v_regular, 1), 0);
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_regular_stations');
  end if;

  if v_status = 'setup' then
    -- 'where true' is required: Supabase API sessions load the safeupdate extension,
    -- which rejects WHERE-less UPDATE/DELETE (SQLSTATE 21000) even inside
    -- SECURITY DEFINER functions called via RPC.
    delete from route_stops where true;
    select coalesce(array_agg(id order by created_at), '{}'::uuid[]) into v_teams from teams;
  else
    select coalesce(array_agg(id order by created_at), '{}'::uuid[]) into v_teams
    from teams t
    where not exists (select 1 from route_stops rs where rs.team_id = t.id);
  end if;

  foreach v_team in array coalesce(v_teams, '{}'::uuid[]) loop
    -- Round-robin start over the shuffled regular stations, then shuffle the rest
    v_start := v_regular[(v_i % v_n) + 1];
    select coalesce(array_agg(u.id order by random()), '{}'::uuid[]) into v_rest
    from unnest(v_regular) as u(id)
    where u.id <> v_start;
    v_route := array[v_start] || v_rest || array[v_final];
    insert into route_stops (team_id, position, station_id)
    select v_team, r.ord, r.sid
    from unnest(v_route) with ordinality as r(sid, ord);
    v_i := v_i + 1;
    v_created := v_created + 1;
  end loop;

  return jsonb_build_object('ok', true, 'teams_routed', v_created);
end;
$$;

create or replace function public.set_team_position(p_team_id uuid, p_position int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int;
  v_pos int;
begin
  perform assert_admin();
  if not exists (select 1 from teams where id = p_team_id) then
    return jsonb_build_object('ok', false, 'error', 'invalid_team');
  end if;
  select count(*)::int into v_total from route_stops where team_id = p_team_id;
  v_pos := least(greatest(p_position, 0), v_total);
  update teams
  set current_position = v_pos,
      finished_at = case
        when v_total > 0 and v_pos = v_total then coalesce(finished_at, now())
        else null
      end
  where id = p_team_id;
  return jsonb_build_object('ok', true, 'position', v_pos);
end;
$$;

revoke execute on function public.generate_routes() from public, anon;
revoke execute on function public.set_team_position(uuid, int) from public, anon;
grant execute on function public.generate_routes() to authenticated, service_role;
grant execute on function public.set_team_position(uuid, int) to authenticated, service_role;
