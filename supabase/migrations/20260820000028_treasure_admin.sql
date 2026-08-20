-- supabase/migrations/20260820000028_treasure_admin.sql
-- Admin RPCs for the one shared treasure, mirroring the route-cell RPCs: admin
-- only, refused while the hunt runs, and reporting collisions as readable codes.
--
-- The treasure and the staggered legs must never name the same location — a team
-- that had already been there would finish at a place it has visited, and
-- start_game refuses that anyway. Both directions are checked: setting the
-- treasure onto a routed location, and routing a team onto the treasure.

create or replace function public.set_treasure(p_station_id uuid, p_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  perform assert_admin();
  if route_edit_blocked() then
    return jsonb_build_object('ok', false, 'error', 'game_running');
  end if;
  if not exists (select 1 from stations where id = p_station_id) then
    return jsonb_build_object('ok', false, 'error', 'no_such_location');
  end if;
  if exists (select 1 from team_stations where station_id = p_station_id) then
    return jsonb_build_object('ok', false, 'error', 'location_used_by_team');
  end if;

  -- The treasure keeps its code when it moves: the slip may already be printed.
  -- normalize_code(null) is '' rather than null, so test the normalised value
  -- for emptiness instead of coalescing on it.
  select case
    when coalesce(normalize_code(p_code), '') <> '' then normalize_code(p_code)
    else treasure_code
  end into v_code
  from game where id = 1;
  if coalesce(v_code, '') = '' then
    v_code := mint_team_code();
  end if;

  update game set treasure_station_id = p_station_id, treasure_code = v_code where id = 1;
  return jsonb_build_object('ok', true, 'code', v_code);
end;
$$;

create or replace function public.set_treasure_code()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  perform assert_admin();
  if route_edit_blocked() then
    return jsonb_build_object('ok', false, 'error', 'game_running');
  end if;
  if not exists (select 1 from game where id = 1 and treasure_station_id is not null) then
    return jsonb_build_object('ok', false, 'error', 'no_treasure');
  end if;

  v_code := mint_team_code();
  update game set treasure_code = v_code where id = 1;
  return jsonb_build_object('ok', true, 'code', v_code);
end;
$$;

create or replace function public.clear_treasure()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_admin();
  if route_edit_blocked() then
    return jsonb_build_object('ok', false, 'error', 'game_running');
  end if;
  update game set treasure_station_id = null, treasure_code = null where id = 1;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.set_treasure(uuid, text) from public, anon;
revoke execute on function public.set_treasure_code() from public, anon;
revoke execute on function public.clear_treasure() from public, anon;
grant execute on function public.set_treasure(uuid, text) to authenticated, service_role;
grant execute on function public.set_treasure_code() to authenticated, service_role;
grant execute on function public.clear_treasure() to authenticated, service_role;

-- The other direction: a route cell may not be pointed at the treasure.
create or replace function public.set_route_cell(p_team_id uuid, p_level int, p_station_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  perform assert_admin();
  if route_edit_blocked() then
    return jsonb_build_object('ok', false, 'error', 'game_running');
  end if;
  if p_level is null or p_level < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_level');
  end if;
  if not exists (select 1 from teams where id = p_team_id) then
    return jsonb_build_object('ok', false, 'error', 'no_such_team');
  end if;
  if not exists (select 1 from stations where id = p_station_id) then
    return jsonb_build_object('ok', false, 'error', 'no_such_location');
  end if;
  if exists (select 1 from game where id = 1 and treasure_station_id = p_station_id) then
    return jsonb_build_object('ok', false, 'error', 'is_the_treasure');
  end if;

  -- the staggering rule: nobody else may be at this location on this level
  if exists (
    select 1 from team_stations
    where level = p_level and station_id = p_station_id and team_id <> p_team_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'location_taken_at_level');
  end if;
  -- and a team never revisits a location
  if exists (
    select 1 from team_stations
    where team_id = p_team_id and station_id = p_station_id and level <> p_level
  ) then
    return jsonb_build_object('ok', false, 'error', 'location_used_by_team');
  end if;

  -- The cell keeps its code across a location change: the slip is already printed.
  begin
    select code into v_code from team_stations where team_id = p_team_id and level = p_level;
    if v_code is null then
      v_code := mint_team_code();
      insert into team_stations (team_id, level, station_id, code)
      values (p_team_id, p_level, p_station_id, v_code);
    else
      update team_stations set station_id = p_station_id
      where team_id = p_team_id and level = p_level;
    end if;
  exception when unique_violation then
    if exists (
      select 1 from team_stations
      where level = p_level and station_id = p_station_id and team_id <> p_team_id
    ) then
      return jsonb_build_object('ok', false, 'error', 'location_taken_at_level');
    end if;
    return jsonb_build_object('ok', false, 'error', 'location_used_by_team');
  end;

  return jsonb_build_object('ok', true, 'code', v_code);
end;
$$;

revoke execute on function public.set_route_cell(uuid, int, uuid) from public, anon;
grant execute on function public.set_route_cell(uuid, int, uuid) to authenticated, service_role;
