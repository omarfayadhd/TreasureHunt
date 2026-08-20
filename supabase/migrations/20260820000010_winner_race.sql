-- supabase/migrations/20260820000010_winner_race.sql
-- Fix round 1 (R16 follow-up): "who finished first" is contended state even
-- though capacity is unlimited. Two teams clearing the FINAL level
-- concurrently could both read "nobody has finished yet" and both become
-- 'winner'. Serialize just that decision on the game row; non-final clears
-- stay lock-free. Lock order is team row then game row, consistently, so
-- there is no deadlock cycle between two teams doing this.

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
    -- Deciding the first finisher is contended state: serialize just this branch.
    -- Non-final clears stay lock-free, since capacity is unlimited.
    perform 1 from game where id = 1 for update;
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
grant execute on function public.submit_code(text, text) to anon, authenticated, service_role;
