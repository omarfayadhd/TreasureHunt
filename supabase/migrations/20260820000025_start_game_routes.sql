-- supabase/migrations/20260820000025_start_game_routes.sql
-- Kickoff validates routes, not the shared station ladder: every team needs
-- levels 1..M with no holes, all teams must agree on M, and the location pool
-- must be at least as large as the field (the staggering rule needs one free
-- location per team at every level). The monitor gains the location each team
-- is currently hunting.

create or replace function public.start_game()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_locations int;
  v_teams int;
  v_levels int;
  v_lengths int;
  v_bad_team text;
begin
  perform assert_admin();
  select status into v_status from game where id = 1;
  if v_status <> 'setup' then
    return jsonb_build_object('ok', false, 'error', 'not_in_setup');
  end if;

  select count(*)::int into v_locations from stations;
  select count(*)::int into v_teams from teams;
  if v_locations = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_stations');
  end if;
  if v_teams = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_teams');
  end if;
  if v_locations < v_teams then
    return jsonb_build_object('ok', false, 'error', 'not_enough_locations',
                              'locations', v_locations, 'teams', v_teams);
  end if;

  -- every team needs levels 1..M with no gaps
  select t.name into v_bad_team
  from teams t
  left join team_stations ts on ts.team_id = t.id
  group by t.id, t.name
  having count(ts.level) = 0
      or count(ts.level) <> max(ts.level)
      or min(ts.level) <> 1
  limit 1;
  if v_bad_team is not null then
    return jsonb_build_object('ok', false, 'error', 'route_incomplete', 'team', v_bad_team);
  end if;

  -- and every team's M must match
  select count(distinct c) into v_lengths from (
    select count(*) as c from team_stations group by team_id
  ) counts;
  if v_lengths > 1 then
    return jsonb_build_object('ok', false, 'error', 'route_length_mismatch');
  end if;

  select count(*)::int into v_levels from team_stations
  where team_id = (select id from teams order by created_at limit 1);

  update game
  set status = 'live', started_at = now(), ended_at = null, initial_team_count = v_teams
  where id = 1;

  return jsonb_build_object('ok', true, 'status', 'live', 'teams', v_teams, 'levels', v_levels);
end;
$$;

-- create or replace resets grants to include PUBLIC, so re-apply them.
revoke execute on function public.start_game() from public, anon;
grant execute on function public.start_game() to authenticated, service_role;

-- The monitor names the location each team is hunting: its next uncleared level.
create or replace view public.admin_monitor
with (security_invoker = true) as
select
  t.id,
  t.name,
  t.team_code,
  t.status,
  t.current_position as cleared_level,
  t.out_at_level,
  t.finished_at,
  t.eliminated_at,
  t.created_at,
  exists (select 1 from card_opens co where co.team_id = t.id and co.level = 1) as started,
  (select max(co.level) from card_opens co where co.team_id = t.id) as max_opened_level,
  (select max(a.created_at) from attempts a where a.team_id = t.id and a.result = 'correct') as last_solve_at,
  (select count(*)::int from attempts a where a.team_id = t.id and a.result = 'wrong') as wrong_count,
  (select s.name from team_stations ts join stations s on s.id = ts.station_id
    where ts.team_id = t.id and ts.level = t.current_position + 1) as current_location
from teams t;

revoke all on public.admin_monitor from anon;
grant select on public.admin_monitor to authenticated;
