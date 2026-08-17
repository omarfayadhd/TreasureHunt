create or replace function public.normalize_code(p text)
returns text
language sql
immutable
as $$
  select upper(trim(p))
$$;

create or replace function public.team_login(p_team_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams%rowtype;
  v_status text;
  v_total int;
  v_clue text;
  v_rank int;
begin
  select * into v_team from teams where team_code = normalize_code(p_team_code);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_team_code');
  end if;

  select status into v_status from game where id = 1;
  select count(*)::int into v_total from route_stops where team_id = v_team.id;

  if v_team.finished_at is not null then
    select count(*)::int + 1 into v_rank
    from teams
    where finished_at is not null and finished_at < v_team.finished_at;
  end if;

  if v_status = 'live' and v_team.finished_at is null then
    select s.clue_text into v_clue
    from route_stops rs
    join stations s on s.id = rs.station_id
    where rs.team_id = v_team.id and rs.position = v_team.current_position + 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'team_name', v_team.name,
    'game_status', v_status,
    'position', v_team.current_position,
    'total', v_total,
    'clue', v_clue,
    'finished', v_team.finished_at is not null,
    'rank', v_rank
  );
end;
$$;

grant execute on function public.team_login(text) to anon, authenticated;
