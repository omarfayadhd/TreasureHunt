-- supabase/migrations/20260820000017_seed_routes.sql
-- Builds a staggered rotation for any team that has no route yet: team i takes
-- the locations rotated by i, so no two teams share a location at one level.
-- Safe on an empty database and a no-op once routes exist.

create or replace function public.seed_missing_routes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stations uuid[];
  v_teams uuid[];
  v_s int;
  v_t int;
  v_i int;
  v_level int;
  v_code text;
begin
  select array_agg(id order by sort_order, id) into v_stations from stations;
  select array_agg(id order by created_at, id) into v_teams
  from teams t where not exists (select 1 from team_stations ts where ts.team_id = t.id);

  v_s := coalesce(array_length(v_stations, 1), 0);
  v_t := coalesce(array_length(v_teams, 1), 0);
  if v_t = 0 then
    return jsonb_build_object('ok', true, 'created', 0);
  end if;
  if v_s = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_locations');
  end if;
  if v_s < (select count(*) from teams) then
    return jsonb_build_object('ok', false, 'error', 'not_enough_locations');
  end if;

  for v_i in 1..v_t loop
    for v_level in 1..v_s loop
      -- rotate: team i starts at location i and wraps around
      v_code := mint_team_code();
      insert into team_stations (team_id, level, station_id, code)
      values (
        v_teams[v_i],
        v_level,
        v_stations[1 + ((v_level - 1 + v_i - 1) % v_s)],
        v_code
      );
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'created', v_t * v_s);
end;
$$;

revoke execute on function public.seed_missing_routes() from public, anon;
grant execute on function public.seed_missing_routes() to authenticated, service_role;

-- Seed the game that exists right now (no-op on a fresh database).
select public.seed_missing_routes();
