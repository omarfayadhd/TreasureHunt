-- supabase/migrations/20260820000009_no_elimination.sql
-- Revision 2: every level has a code for every team. No slots, no sweep, no
-- elimination. The first team to clear the final level wins; later finishers
-- are placed behind it by finish time.

create or replace function public.team_view_json(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams%rowtype;
  v_status text;
  v_total int;
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

  select status into v_status from game where id = 1;
  select count(*)::int into v_total from stations;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'level', s.sort_order,
        'unlocked', u.unlocked,
        'opened', co.team_id is not null,
        'clue', case when u.unlocked then s.clue_text else null end
      )
      order by s.sort_order
    ),
    '[]'::jsonb
  )
  into v_cards
  from stations s
  cross join lateral (
    select (v_status = 'live' and s.sort_order <= v_team.current_position + 1) as unlocked
  ) u
  left join card_opens co on co.team_id = v_team.id and co.level = s.sort_order;

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

create or replace function public.submit_code(p_team_code text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams%rowtype;
  v_status text;
  v_code text := normalize_code(p_code);
  v_last timestamptz;
  v_wait int;
  v_total int;
  v_level int;
  v_expected text;
  v_first boolean;
begin
  select status into v_status from game where id = 1;

  -- Only this team's own row needs locking now: clearing a level is
  -- uncontended, so there is no global slot to serialize on.
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

  select count(*)::int into v_total from stations;
  v_level := v_team.current_position + 1;

  if exists (select 1 from stations where code = v_code and sort_order <= v_team.current_position) then
    insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'already_used');
    return jsonb_build_object(
      'ok', true, 'correct', false, 'reason', 'already_used', 'view', team_view_json(v_team.id)
    );
  end if;

  select code into v_expected from stations where sort_order = v_level;
  if v_expected is distinct from v_code then
    insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'wrong');
    return jsonb_build_object(
      'ok', true, 'correct', false, 'reason', 'wrong', 'view', team_view_json(v_team.id)
    );
  end if;

  insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'correct');

  if v_level >= v_total then
    select not exists (select 1 from teams where finished_at is not null) into v_first;
    update teams
    set current_position = v_level,
        finished_at = now(),
        status = case when v_first then 'winner' else 'finished' end
    where id = v_team.id;
  else
    update teams set current_position = v_level where id = v_team.id;
  end if;

  return jsonb_build_object('ok', true, 'correct', true, 'view', team_view_json(v_team.id));
end;
$$;

-- create or replace resets grants to include PUBLIC, so re-apply them.
revoke execute on function public.team_view_json(uuid) from public, anon;
grant execute on function public.submit_code(text, text) to anon, authenticated, service_role;
