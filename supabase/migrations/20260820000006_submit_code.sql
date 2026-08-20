-- supabase/migrations/20260820000006_submit_code.sql

create or replace function public.submit_code(p_team_code text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams%rowtype;
  v_status text;
  v_initial int;
  v_code text := normalize_code(p_code);
  v_last timestamptz;
  v_wait int;
  v_total int;
  v_level int;
  v_alive int;
  v_slots int;
  v_taken int;
  v_expected text;
  v_first boolean;
begin
  -- Every submit queues on the single game row, so two teams racing for the
  -- last slot are resolved one at a time instead of both seeing it free.
  select status, initial_team_count into v_status, v_initial from game where id = 1 for update;

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

  -- The opening race fits everyone; later races drop the slowest team.
  -- Winners and finishers still hold their slot, so only eliminated teams leave the pool.
  select count(*)::int into v_alive from teams where status <> 'eliminated';
  v_slots := case when v_level <= 1 then v_alive else greatest(v_alive - 1, 1) end;
  select count(*)::int into v_taken from teams where current_position >= v_level;

  if v_taken >= v_slots then
    insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'too_late');
    update teams
    set status = 'eliminated', eliminated_at = now(), out_at_level = v_level
    where id = v_team.id;
    return jsonb_build_object(
      'ok', true, 'correct', false, 'reason', 'too_late', 'view', team_view_json(v_team.id)
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

  -- This clear took the last slot: everyone still below this level is out.
  if v_taken + 1 >= v_slots then
    update teams
    set status = 'eliminated', eliminated_at = now(), out_at_level = v_level
    where status = 'playing' and current_position < v_level;
  end if;

  -- Last team standing wins outright. Skipped for a solo practice game so a
  -- single team can walk the whole ladder, and skipped once anyone has finished
  -- (with fewer levels than teams, the others are finishers, not casualties).
  if coalesce(v_initial, 0) > 1
     and (select count(*) from teams where status = 'playing') = 1
     and not exists (select 1 from teams where finished_at is not null) then
    update teams
    set status = 'winner', finished_at = coalesce(finished_at, now())
    where status = 'playing';
  end if;

  return jsonb_build_object('ok', true, 'correct', true, 'view', team_view_json(v_team.id));
end;
$$;

grant execute on function public.submit_code(text, text) to anon, authenticated, service_role;
