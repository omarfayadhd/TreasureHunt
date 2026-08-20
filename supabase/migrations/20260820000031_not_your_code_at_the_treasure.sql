-- supabase/migrations/20260820000031_not_your_code_at_the_treasure.sql
-- A team standing on the treasure leg that typed a code copied from another team
-- was told "wrong", because the not_your_code check only existed on the
-- staggered legs. Same answer everywhere now: a rival's code is a rival's code.

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
      -- A code issued to somebody else reads the same here as on any other
      -- level: the team should hear whose it is, not just that it is wrong.
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
