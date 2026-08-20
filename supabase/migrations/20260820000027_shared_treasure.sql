-- supabase/migrations/20260820000027_shared_treasure.sql
-- One treasure for the whole hunt: the same final location and the same code for
-- every team. Routes in team_stations stay the staggered legs (levels 1..M) and
-- keep all four of their uniqueness rules; the treasure is level M+1 for
-- everybody and lives on the game row instead.
--
-- The rule this encodes: the first team to submit the treasure code wins, and
-- nobody else can. A later team that reaches an already-claimed treasure is told
-- so and does NOT advance — no second place, no placement anywhere. Crucially,
-- nothing about another team's win touches a team's own row or the game status,
-- so a team still hunting learns nothing until it stands at the empty box.

alter table public.game
  add column if not exists treasure_station_id uuid references public.stations (id) on delete restrict,
  add column if not exists treasure_code text;

alter table public.game drop constraint if exists game_treasure_code_check;
alter table public.game
  add constraint game_treasure_code_check
  check (treasure_code is null or treasure_code ~ '^[A-Z0-9]{3,12}$');

alter table public.attempts drop constraint attempts_result_check;
alter table public.attempts
  add constraint attempts_result_check
  check (result in ('correct', 'wrong', 'already_used', 'too_late', 'not_your_code', 'treasure_claimed'));

-- The treasure adds a final card to every team's ladder, with the same location
-- and clue for everyone. Its level is one past the team's last staggered leg.
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
        'location', case when u.unlocked then s.name else null end
      )
      order by ts.level
    ),
    '[]'::jsonb
  )
  into v_cards
  from team_stations ts
  join stations s on s.id = ts.station_id
  cross join lateral (
    select (v_status = 'live' and ts.level <= v_team.current_position + 1) as unlocked
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
      'location', case
        when v_status = 'live' and v_legs + 1 <= v_team.current_position + 1 then v_treasure.name
        else null end
    ));
  end if;

  -- Progress info only: a full `found` never blocks anyone.
  if v_team.status = 'playing' and v_status = 'live' and v_team.current_position < v_total then
    v_level := v_team.current_position + 1;
    select count(*)::int into v_found from teams where current_position >= v_level;
    select count(*)::int into v_teams from teams;
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
    'cards', v_cards
  );
end;
$$;

revoke execute on function public.team_view_json(uuid) from public, anon;
grant execute on function public.team_view_json(uuid) to authenticated, service_role;

-- The treasure's clue is the same for every team, so open_card reads it off the
-- game row once a team is past its last staggered leg.
create or replace function public.open_card(p_team_code text, p_level int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams%rowtype;
  v_status text;
  v_treasure_id uuid;
  v_legs int;
  v_clue text;
begin
  select * into v_team from teams where team_code = normalize_code(p_team_code);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_team_code');
  end if;

  select status, treasure_station_id into v_status, v_treasure_id from game where id = 1;
  if v_status <> 'live' then
    return jsonb_build_object('ok', false, 'error', 'game_not_live');
  end if;

  if p_level is null or p_level < 1 or p_level > v_team.current_position + 1 then
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;

  select count(*)::int into v_legs from team_stations where team_id = v_team.id;

  if p_level <= v_legs then
    select s.clue_text into v_clue
    from team_stations ts
    join stations s on s.id = ts.station_id
    where ts.team_id = v_team.id and ts.level = p_level;
  elsif p_level = v_legs + 1 and v_treasure_id is not null then
    select clue_text into v_clue from stations where id = v_treasure_id;
  end if;

  if v_clue is null then
    return jsonb_build_object('ok', false, 'error', 'no_such_level');
  end if;

  insert into card_opens (team_id, level) values (v_team.id, p_level)
  on conflict (team_id, level) do nothing;

  return jsonb_build_object(
    'ok', true, 'level', p_level, 'clue', v_clue, 'view', team_view_json(v_team.id)
  );
end;
$$;

grant execute on function public.open_card(text, int) to anon, authenticated, service_role;

-- Staggered legs are matched against the team's own codes, exactly as before.
-- The final level is the treasure: one code, shared, and only the first team to
-- send it wins. Everyone after is told the treasure is gone and stays put.
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
    -- The treasure leg. The code is shared, so the only thing to decide is who
    -- got here first; the game row serialises that.
    if normalize_code(v_treasure_code) is distinct from v_code then
      insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'wrong');
      return jsonb_build_object(
        'ok', true, 'correct', false, 'reason', 'wrong', 'view', team_view_json(v_team.id)
      );
    end if;

    perform 1 from game where id = 1 for update;
    select exists (select 1 from teams where status = 'winner') into v_claimed;
    if v_claimed then
      -- Somebody already has it. Say so, and leave this team exactly where it was:
      -- there is no second place to award.
      insert into attempts (team_id, submitted_code, result)
      values (v_team.id, v_code, 'treasure_claimed');
      return jsonb_build_object(
        'ok', true, 'correct', false, 'reason', 'treasure_claimed', 'view', team_view_json(v_team.id)
      );
    end if;

    insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'correct');
    -- clock_timestamp(), not now(): now() is fixed at transaction start, before
    -- this lock was taken, so it can disagree with the order the lock decided.
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

-- Kickoff also needs a treasure, and it must sit outside every route: a team
-- that had already visited it would be walking to an empty box for its finish.
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
  -- The treasure is shared, so only the staggered legs need one location per team.
  if v_locations - 1 < v_teams then
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

  select count(*)::int into v_legs from team_stations
  where team_id = (select id from teams order by created_at limit 1);

  update game
  set status = 'live', started_at = now(), ended_at = null, initial_team_count = v_teams
  where id = 1;

  -- `levels` counts the treasure: it is a card the team has to clear.
  return jsonb_build_object('ok', true, 'status', 'live', 'teams', v_teams, 'levels', v_legs + 1);
end;
$$;

revoke execute on function public.start_game() from public, anon;
grant execute on function public.start_game() to authenticated, service_role;

-- A team on its final leg is hunting the treasure, so name that rather than
-- leaving the column empty.
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
  -- When this team reached an already-claimed treasure. The winner is the team
  -- with status 'winner'; everyone here arrived too late.
  (select max(a.created_at) from attempts a
    where a.team_id = t.id and a.result = 'treasure_claimed') as too_late_at
from teams t;

revoke all on public.admin_monitor from anon;
grant select on public.admin_monitor to authenticated;
