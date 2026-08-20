-- supabase/migrations/20260820000022_seed_routes_fix.sql
-- Fix round 1 for seed_missing_routes(): the previous version derived each
-- unrouted team's rotation offset purely from its index within the unrouted
-- subset, ignoring (level, station_id) pairs already claimed by teams that
-- were routed by hand before the migration ran. That is a real production
-- path (a route authored before this function ever runs), and it made the
-- whole call raise an unhandled unique_violation and roll back, leaving the
-- unrouted team with zero rows forever (every retry hit the same collision).
--
-- Replaced with an occupancy-aware greedy assignment:
--   1. Route length is settled first. If routed teams disagree on how many
--      levels they have, refuse outright (start_game's route_length_mismatch
--      guard would reject the game anyway) rather than guess.
--   2. For each unrouted team, for each level, scan all locations in a
--      rotated order (still team-index-offset, to keep the plain "nobody has
--      a route yet" case identical to the old rotation) and take the first
--      one that is free at that level and not already used by this team.
--      Occupancy is tracked locally (starting from what is already in
--      team_stations) and updated as each pick is made, so teams seeded in
--      the same call see each other's picks too.
--   3. The whole plan is computed before any writes. If some team/level has
--      no available location, nothing is written and the function returns
--      {ok:false, error:'no_valid_rotation', team, level} instead of ever
--      reaching an insert that could conflict. The actual inserts are still
--      wrapped against unique_violation (a defensive fallback for a race with
--      a concurrent writer) and reported as {ok:false, error:'rotation_conflict'}
--      rather than raising.
--
-- Note: a greedy, non-backtracking scan is not a complete SDR solver — for
-- some existing occupancy patterns a valid completion exists in theory but
-- this scan will not find it and will report no_valid_rotation. That is an
-- accepted, documented limitation (see task-2-report.md), not a defect in
-- the safety properties above: it never raises, never corrupts data, and the
-- straightforward "no existing routes" and "one hand-authored team with a
-- simple rotation" cases this repo actually needs are covered by tests.

create or replace function public.seed_missing_routes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stations uuid[];
  v_teams uuid[];
  v_team_names text[];
  v_s int;
  v_t int;
  v_lengths int[];
  v_m int;
  v_taken text[] := '{}';
  v_team_used uuid[];
  v_plan_team uuid[] := '{}';
  v_plan_level int[] := '{}';
  v_plan_station uuid[] := '{}';
  v_i int;
  v_level int;
  v_start int;
  v_offset int;
  v_k int;
  v_candidate uuid;
  v_found boolean;
  v_p int;
  v_code text;
begin
  select array_agg(id order by sort_order, id) into v_stations from stations;
  v_s := coalesce(array_length(v_stations, 1), 0);

  select array_agg(t.id order by t.created_at, t.id), array_agg(t.name order by t.created_at, t.id)
    into v_teams, v_team_names
  from teams t
  where not exists (select 1 from team_stations ts where ts.team_id = t.id);
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

  -- Settle the target route length: routed teams must agree on it.
  select array_agg(distinct cnt) into v_lengths
  from (select count(*) as cnt from team_stations group by team_id) lens;

  if coalesce(array_length(v_lengths, 1), 0) > 1 then
    return jsonb_build_object('ok', false, 'error', 'existing_routes_uneven');
  elsif array_length(v_lengths, 1) = 1 then
    v_m := v_lengths[1];
  else
    v_m := v_s;
  end if;

  -- Seed occupancy from whatever is already claimed.
  select array_agg(level::text || ':' || station_id::text) into v_taken from team_stations;
  if v_taken is null then
    v_taken := '{}';
  end if;

  -- Plan the whole assignment in memory first; write nothing until every
  -- unrouted team has a complete, valid route.
  for v_i in 1..v_t loop
    v_team_used := '{}'::uuid[];
    for v_level in 1..v_m loop
      v_start := ((v_level - 1 + v_i - 1) % v_s) + 1;
      v_found := false;
      for v_offset in 0..v_s - 1 loop
        v_k := ((v_start - 1 + v_offset) % v_s) + 1;
        v_candidate := v_stations[v_k];
        if not (v_level::text || ':' || v_candidate::text = any (v_taken))
           and not (v_candidate = any (v_team_used)) then
          v_found := true;
          exit;
        end if;
      end loop;

      if not v_found then
        return jsonb_build_object(
          'ok', false,
          'error', 'no_valid_rotation',
          'team', v_team_names[v_i],
          'level', v_level
        );
      end if;

      v_taken := v_taken || (v_level::text || ':' || v_candidate::text);
      v_team_used := v_team_used || v_candidate;
      v_plan_team := v_plan_team || v_teams[v_i];
      v_plan_level := v_plan_level || v_level;
      v_plan_station := v_plan_station || v_candidate;
    end loop;
  end loop;

  -- Only now write the plan. A unique_violation here (e.g. a concurrent
  -- writer) is reported gracefully rather than raised.
  begin
    for v_p in 1..array_length(v_plan_team, 1) loop
      v_code := mint_team_code();
      insert into team_stations (team_id, level, station_id, code)
      values (v_plan_team[v_p], v_plan_level[v_p], v_plan_station[v_p], v_code);
    end loop;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'rotation_conflict');
  end;

  return jsonb_build_object('ok', true, 'created', v_t * v_m);
end;
$$;

-- create or replace resets grants to PUBLIC: re-apply the revoke/grant pair.
revoke execute on function public.seed_missing_routes() from public, anon;
grant execute on function public.seed_missing_routes() to authenticated, service_role;

-- Re-seed the game that exists right now (no-op on a fresh database, and a
-- no-op on any team that already has a route from the previous migration).
select public.seed_missing_routes();
