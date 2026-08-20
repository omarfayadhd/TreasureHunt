-- supabase/migrations/20260820000030_demo_team.sql
-- A permanent demo team, for showing colleagues how the hunt works without
-- touching the real one.
--
-- It plays exactly like a real team — its own staggered legs, its own codes, the
-- same clue sheets — so the demonstration is the real thing. The only difference
-- is the finish: submitting the treasure code gives the demo team the whole
-- celebration but does NOT take the treasure. It never becomes the winner, it
-- never blocks a real team, and the run can be replayed as often as you like,
-- before or after a real team has won.
--
-- It is also invisible in the numbers real teams see: the race count and the
-- kickoff snapshot count real teams only, so a demo run never looks to a player
-- like a rival closing in.

alter table public.teams
  add column if not exists is_demo boolean not null default false,
  add column if not exists demo_won_at timestamptz;

-- At most one demo team: the admin UI hands the flag over rather than accumulating.
create unique index if not exists teams_single_demo on public.teams (is_demo) where is_demo;

create or replace function public.set_demo_team(p_team_id uuid, p_is_demo boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_admin();
  if not exists (select 1 from teams where id = p_team_id) then
    return jsonb_build_object('ok', false, 'error', 'no_such_team');
  end if;

  if p_is_demo then
    -- The flag moves rather than duplicating, so the unique index never fires.
    update teams set is_demo = false, demo_won_at = null where is_demo and id <> p_team_id;
    update teams set is_demo = true where id = p_team_id;
  else
    update teams set is_demo = false, demo_won_at = null where id = p_team_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- Rewind the demo team to the start. Allowed while the hunt is live: replaying a
-- demonstration mid-game is the whole point, and it touches nothing else.
create or replace function public.reset_demo_team()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform assert_admin();
  select id into v_id from teams where is_demo;
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_demo_team');
  end if;

  delete from card_opens where team_id = v_id;
  delete from attempts where team_id = v_id;
  update teams
  set current_position = 0, demo_won_at = null, status = 'playing',
      finished_at = null, eliminated_at = null, out_at_level = null
  where id = v_id;

  return jsonb_build_object('ok', true, 'team_id', v_id);
end;
$$;

revoke execute on function public.set_demo_team(uuid, boolean) from public, anon;
revoke execute on function public.reset_demo_team() from public, anon;
grant execute on function public.set_demo_team(uuid, boolean) to authenticated, service_role;
grant execute on function public.reset_demo_team() to authenticated, service_role;

-- team_view tells the app whether it is the demo team and whether its demo run
-- has reached the treasure; the race counts real teams only.
create or replace function public.team_view_json(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams%rowtype;
  v_status text;
  v_legs int;
  v_total int;
  v_treasure_id uuid;
  v_treasure stations%rowtype;
  v_level int;
  v_found int;
  v_teams int;
  v_race jsonb;
  v_cards jsonb;
  v_place int;
begin
  select * into v_team from teams where id = p_team_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_team_code');
  end if;

  select status, treasure_station_id into v_status, v_treasure_id from game where id = 1;
  select count(*)::int into v_legs from team_stations where team_id = p_team_id;
  v_total := v_legs + case when v_treasure_id is null then 0 else 1 end;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'level', ts.level,
        'unlocked', u.unlocked,
        'opened', co.team_id is not null,
        'clue', case when u.unlocked then s.clue_text else null end,
        -- cleared, NOT merely unlocked: the answer follows the solve
        'location', case when u.cleared then s.name else null end
      )
      order by ts.level
    ),
    '[]'::jsonb
  )
  into v_cards
  from team_stations ts
  join stations s on s.id = ts.station_id
  cross join lateral (
    select
      (v_status = 'live' and ts.level <= v_team.current_position + 1) as unlocked,
      (ts.level <= v_team.current_position) as cleared
  ) u
  left join card_opens co on co.team_id = v_team.id and co.level = ts.level
  where ts.team_id = v_team.id;

  if v_treasure_id is not null then
    select * into v_treasure from stations where id = v_treasure_id;
    v_cards := v_cards || jsonb_build_array(jsonb_build_object(
      'level', v_legs + 1,
      'unlocked', v_status = 'live' and v_legs + 1 <= v_team.current_position + 1,
      'opened', exists (
        select 1 from card_opens co where co.team_id = v_team.id and co.level = v_legs + 1
      ),
      'clue', case
        when v_status = 'live' and v_legs + 1 <= v_team.current_position + 1 then v_treasure.clue_text
        else null end,
      -- Only the team that claimed the treasure is ever told where it was.
      'location', case when v_legs + 1 <= v_team.current_position then v_treasure.name else null end
    ));
  end if;

  -- Progress info only: a full `found` never blocks anyone. The demo team is not
  -- a rival, so it is counted in neither figure.
  if v_team.status = 'playing' and v_status = 'live' and v_team.current_position < v_total then
    v_level := v_team.current_position + 1;
    select count(*)::int into v_found
    from teams where current_position >= v_level and not is_demo;
    select count(*)::int into v_teams from teams where not is_demo;
    v_race := jsonb_build_object('level', v_level, 'found', v_found, 'teams', v_teams);
  end if;

  if v_team.finished_at is not null then
    select count(*)::int + 1 into v_place
    from teams t
    where t.id <> v_team.id
      and t.finished_at is not null
      and t.finished_at < v_team.finished_at;
  end if;

  return jsonb_build_object(
    'ok', true,
    'team_name', v_team.name,
    'game_status', v_status,
    'status', v_team.status,
    'cleared', v_team.current_position,
    'total', v_total,
    'out_at_level', v_team.out_at_level,
    'place', v_place,
    'race', v_race,
    'cards', v_cards,
    'demo', v_team.is_demo,
    'demo_won', v_team.demo_won_at is not null
  );
end;
$$;

revoke execute on function public.team_view_json(uuid) from public, anon;
grant execute on function public.team_view_json(uuid) to authenticated, service_role;

create or replace function public.submit_code(p_team_code text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams%rowtype;
  v_status text;
  v_treasure_id uuid;
  v_treasure_code text;
  v_code text := normalize_code(p_code);
  v_last timestamptz;
  v_wait int;
  v_legs int;
  v_total int;
  v_level int;
  v_expected text;
  v_claimed boolean;
begin
  select status, treasure_station_id, treasure_code
    into v_status, v_treasure_id, v_treasure_code
  from game where id = 1;

  select * into v_team from teams where team_code = normalize_code(p_team_code) for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_team_code');
  end if;
  if v_status <> 'live' then
    return jsonb_build_object('ok', false, 'error', 'game_not_live');
  end if;
  if v_team.status <> 'playing' then
    return jsonb_build_object('ok', false, 'error', 'not_playing');
  end if;

  select max(created_at) into v_last from attempts where team_id = v_team.id;
  if v_last is not null and v_last > now() - interval '5 seconds' then
    v_wait := ceil(extract(epoch from (v_last + interval '5 seconds') - now()))::int;
    return jsonb_build_object(
      'ok', false, 'error', 'cooldown', 'retry_after_seconds', greatest(v_wait, 1)
    );
  end if;

  select count(*)::int into v_legs from team_stations where team_id = v_team.id;
  v_total := v_legs + case when v_treasure_id is null then 0 else 1 end;
  v_level := v_team.current_position + 1;

  -- one of this team's own earlier codes
  if exists (
    select 1 from team_stations
    where team_id = v_team.id and level <= v_team.current_position and code = v_code
  ) then
    insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'already_used');
    return jsonb_build_object(
      'ok', true, 'correct', false, 'reason', 'already_used', 'view', team_view_json(v_team.id)
    );
  end if;

  if v_level > v_legs and v_treasure_id is not null then
    if normalize_code(v_treasure_code) is distinct from v_code then
      insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'wrong');
      return jsonb_build_object(
        'ok', true, 'correct', false, 'reason', 'wrong', 'view', team_view_json(v_team.id)
      );
    end if;

    -- The demo team gets the celebration and leaves the treasure where it is: no
    -- winner, no claim, no effect on anyone, and repeatable.
    if v_team.is_demo then
      insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'correct');
      update teams set demo_won_at = clock_timestamp() where id = v_team.id;
      return jsonb_build_object('ok', true, 'correct', true, 'view', team_view_json(v_team.id));
    end if;

    perform 1 from game where id = 1 for update;
    select exists (select 1 from teams where status = 'winner') into v_claimed;
    if v_claimed then
      insert into attempts (team_id, submitted_code, result)
      values (v_team.id, v_code, 'treasure_claimed');
      return jsonb_build_object(
        'ok', true, 'correct', false, 'reason', 'treasure_claimed', 'view', team_view_json(v_team.id)
      );
    end if;

    insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'correct');
    update teams
    set current_position = v_level, finished_at = clock_timestamp(), status = 'winner'
    where id = v_team.id;
    return jsonb_build_object('ok', true, 'correct', true, 'view', team_view_json(v_team.id));
  end if;

  -- A staggered leg: this team's own code for this level, and nobody else's.
  select code into v_expected from team_stations where team_id = v_team.id and level = v_level;

  if v_expected is distinct from v_code then
    if exists (select 1 from team_stations where code = v_code and team_id <> v_team.id) then
      insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'not_your_code');
      return jsonb_build_object(
        'ok', true, 'correct', false, 'reason', 'not_your_code', 'view', team_view_json(v_team.id)
      );
    end if;
    insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'wrong');
    return jsonb_build_object(
      'ok', true, 'correct', false, 'reason', 'wrong', 'view', team_view_json(v_team.id)
    );
  end if;

  insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'correct');
  update teams set current_position = v_level where id = v_team.id;
  return jsonb_build_object('ok', true, 'correct', true, 'view', team_view_json(v_team.id));
end;
$$;

grant execute on function public.submit_code(text, text) to anon, authenticated, service_role;

-- The kickoff snapshot counts real teams: the demo team is not in the race.
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
  v_real_teams int;
  v_legs int;
  v_lengths int;
  v_bad_team text;
  v_treasure_id uuid;
  v_treasure_code text;
begin
  perform assert_admin();
  select status, treasure_station_id, treasure_code
    into v_status, v_treasure_id, v_treasure_code
  from game where id = 1;
  if v_status <> 'setup' then
    return jsonb_build_object('ok', false, 'error', 'not_in_setup');
  end if;

  select count(*)::int into v_locations from stations;
  select count(*)::int into v_teams from teams;
  select count(*)::int into v_real_teams from teams where not is_demo;
  if v_locations = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_stations');
  end if;
  if v_teams = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_teams');
  end if;
  if v_treasure_id is null or v_treasure_code is null then
    return jsonb_build_object('ok', false, 'error', 'no_treasure');
  end if;
  if exists (select 1 from team_stations where station_id = v_treasure_id) then
    return jsonb_build_object('ok', false, 'error', 'treasure_in_route');
  end if;
  -- The demo team walks real legs, so it still needs a location of its own at
  -- every level: the pool is measured against every team, demo included.
  if v_locations - 1 < v_teams then
    return jsonb_build_object('ok', false, 'error', 'not_enough_locations',
                              'locations', v_locations, 'teams', v_teams);
  end if;

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

  select count(distinct c) into v_lengths from (
    select count(*) as c from team_stations group by team_id
  ) counts;
  if v_lengths > 1 then
    return jsonb_build_object('ok', false, 'error', 'route_length_mismatch');
  end if;

  select count(*)::int into v_legs from team_stations
  where team_id = (select id from teams order by created_at limit 1);

  update game
  set status = 'live', started_at = now(), ended_at = null, initial_team_count = v_real_teams
  where id = 1;

  return jsonb_build_object(
    'ok', true, 'status', 'live', 'teams', v_real_teams, 'levels', v_legs + 1
  );
end;
$$;

revoke execute on function public.start_game() from public, anon;
grant execute on function public.start_game() to authenticated, service_role;

-- The board says which row is the demo, so a demo run is never mistaken for play.
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
  coalesce(
    (select s.name from team_stations ts join stations s on s.id = ts.station_id
      where ts.team_id = t.id and ts.level = t.current_position + 1),
    (select s.name from game g join stations s on s.id = g.treasure_station_id
      where g.id = 1
        and t.current_position = (select count(*) from team_stations ts where ts.team_id = t.id))
  ) as current_location,
  (select max(a.created_at) from attempts a
    where a.team_id = t.id and a.result = 'treasure_claimed') as too_late_at,
  -- Appended, not inserted: `create or replace view` may only add columns at the
  -- end, never rename or reorder the existing ones.
  t.is_demo,
  t.demo_won_at
from teams t;

revoke all on public.admin_monitor from anon;
grant select on public.admin_monitor to authenticated;
