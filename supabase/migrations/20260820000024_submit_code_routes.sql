-- supabase/migrations/20260820000024_submit_code_routes.sql
-- Codes are team-specific. submit_code only ever compares against the calling
-- team's own team_stations rows, so a code copied off another team's slip is
-- refused with a distinct `not_your_code` answer instead of silently reading as
-- a wrong guess.

alter table public.attempts drop constraint attempts_result_check;
alter table public.attempts
  add constraint attempts_result_check
  check (result in ('correct', 'wrong', 'already_used', 'too_late', 'not_your_code'));

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

  -- The ladder length is this team's own route length, not the location count.
  select count(*)::int into v_total from team_stations where team_id = v_team.id;
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

  select code into v_expected from team_stations where team_id = v_team.id and level = v_level;

  if v_expected is distinct from v_code then
    -- a real code, but issued to somebody else
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

  if v_level >= v_total then
    -- Deciding the first finisher is contended state: serialize just this branch.
    -- Non-final clears stay lock-free, since capacity is unlimited.
    perform 1 from game where id = 1 for update;
    select not exists (select 1 from teams where finished_at is not null) into v_first;
    -- clock_timestamp(), NOT now(): now() is the transaction-start time, which is
    -- fixed before this lock is acquired, so it can order the finishers
    -- differently from the lock that actually decides who won.
    update teams
    set current_position = v_level,
        finished_at = clock_timestamp(),
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
