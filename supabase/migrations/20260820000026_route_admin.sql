-- supabase/migrations/20260820000026_route_admin.sql
-- Route editing for the admin: one cell of the teams x levels grid at a time.
-- Every write is admin-only, refuses while the game is running (a live route
-- change would turn a posted paper code into a wrong answer), and reports the
-- two staggering collisions as readable codes instead of a raw constraint name.

-- mint_team_code only avoided teams.team_code, so a minted route code could
-- collide with a code already issued to another team (team_stations.code is
-- globally unique) and raise unique_violation. Avoid both namespaces: a value
-- that is a team's login code must not also be a station code.
create or replace function public.mint_team_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_code text;
begin
  loop
    v_code := random_team_code();
    exit when not exists (select 1 from teams where team_code = v_code)
         and not exists (select 1 from team_stations where code = v_code);
  end loop;
  return v_code;
end;
$$;

revoke execute on function public.mint_team_code() from public, anon;
grant execute on function public.mint_team_code() to authenticated, service_role;

-- Shared guard: routes are setup-time data.
create or replace function public.route_edit_blocked()
returns boolean
language sql
security definer
set search_path = public
as $$
  select status in ('live', 'paused') from game where id = 1
$$;

revoke execute on function public.route_edit_blocked() from public, anon;
grant execute on function public.route_edit_blocked() to authenticated, service_role;

-- Point one team's level at a location, minting that cell's code if it has none.
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
    -- A concurrent editor claimed the same pair between the checks and the write.
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

-- Reissue one cell's code (a slip went missing, or a code leaked to a rival).
create or replace function public.set_route_code(p_team_id uuid, p_level int)
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
  if not exists (select 1 from team_stations where team_id = p_team_id and level = p_level) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_code := mint_team_code();
  update team_stations set code = v_code where team_id = p_team_id and level = p_level;
  return jsonb_build_object('ok', true, 'code', v_code);
end;
$$;

create or replace function public.clear_route_cell(p_team_id uuid, p_level int)
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
  delete from team_stations where team_id = p_team_id and level = p_level;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.set_route_cell(uuid, int, uuid) from public, anon;
revoke execute on function public.set_route_code(uuid, int) from public, anon;
revoke execute on function public.clear_route_cell(uuid, int) from public, anon;
grant execute on function public.set_route_cell(uuid, int, uuid) to authenticated, service_role;
grant execute on function public.set_route_code(uuid, int) to authenticated, service_role;
grant execute on function public.clear_route_cell(uuid, int) to authenticated, service_role;

-- suggest_station_code() still read `stations.code`, a column that no longer
-- exists: any call raised undefined_column. Codes belong to route cells now and
-- are minted by set_route_cell / set_route_code, so the function is dead weight.
drop function if exists public.suggest_station_code();
