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
  v_next stations%rowtype;
  v_clue text;
  v_rank int;
begin
  -- Lock the team row: serializes concurrent submits from the same team
  select * into v_team from teams where team_code = normalize_code(p_team_code) for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_team_code');
  end if;

  select status into v_status from game where id = 1;
  if v_status <> 'live' then
    return jsonb_build_object('ok', false, 'error', 'game_not_live');
  end if;

  if v_team.finished_at is not null then
    return jsonb_build_object('ok', false, 'error', 'already_finished');
  end if;

  select max(created_at) into v_last from attempts where team_id = v_team.id;
  if v_last is not null and v_last > now() - interval '5 seconds' then
    v_wait := ceil(extract(epoch from (v_last + interval '5 seconds') - now()))::int;
    return jsonb_build_object('ok', false, 'error', 'cooldown', 'retry_after_seconds', greatest(v_wait, 1));
  end if;

  select count(*)::int into v_total from route_stops where team_id = v_team.id;

  -- A code the team already solved gets a friendly nudge, not a generic wrong
  if exists (
    select 1
    from route_stops rs
    join stations s on s.id = rs.station_id
    where rs.team_id = v_team.id
      and rs.position <= v_team.current_position
      and s.code = v_code
  ) then
    insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'already_used');
    return jsonb_build_object('ok', true, 'correct', false, 'reason', 'already_used');
  end if;

  select s.* into v_next
  from route_stops rs
  join stations s on s.id = rs.station_id
  where rs.team_id = v_team.id and rs.position = v_team.current_position + 1;

  if v_next.code is distinct from v_code then
    insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'wrong');
    return jsonb_build_object('ok', true, 'correct', false, 'reason', 'wrong');
  end if;

  insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'correct');
  update teams
  set current_position = current_position + 1,
      finished_at = case when v_team.current_position + 1 = v_total then now() else null end
  where id = v_team.id;

  if v_team.current_position + 1 = v_total then
    select count(*)::int + 1 into v_rank
    from teams t
    where t.finished_at is not null
      and t.id <> v_team.id
      and t.finished_at < (select finished_at from teams where id = v_team.id);
    return jsonb_build_object(
      'ok', true, 'correct', true, 'finished', true,
      'position', v_total, 'total', v_total, 'rank', v_rank
    );
  end if;

  select s.clue_text into v_clue
  from route_stops rs
  join stations s on s.id = rs.station_id
  where rs.team_id = v_team.id and rs.position = v_team.current_position + 2;

  return jsonb_build_object(
    'ok', true, 'correct', true, 'finished', false,
    'position', v_team.current_position + 1, 'total', v_total, 'clue', v_clue
  );
end;
$$;

grant execute on function public.submit_code(text, text) to anon, authenticated;
