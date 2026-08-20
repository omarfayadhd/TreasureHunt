-- supabase/migrations/20260820000012_winner_clock.sql
-- Fix round 2: the winner could be shown as 2nd place. `finished_at` was set
-- from now() (transaction-start time), while the winner decision is serialized
-- later inside the transaction on the game-row lock. A transaction that starts
-- earlier but reaches the lock later got an earlier finished_at than the actual
-- winner, and `place` (ordered on finished_at) then put the winner second.
-- Reproduced deterministically with two overlapping transactions.

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
    -- clock_timestamp(), NOT now(): now() is the transaction-start time, which is
    -- fixed before this lock is acquired, so it can order the finishers
    -- differently from the lock that actually decides who won. `place` is derived
    -- by ordering on finished_at, so the disagreement showed up as the winning
    -- team's phone reading "finished 2nd!". clock_timestamp() advances with real
    -- time inside the transaction and therefore always agrees with lock order.
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
