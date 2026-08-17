create or replace function public.assert_admin()
returns void
language plpgsql
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authorized';
  end if;
end;
$$;

create or replace function public.start_game()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_station_count int;
  v_missing int;
begin
  perform assert_admin();
  select status into v_status from game where id = 1;
  if v_status <> 'setup' then
    return jsonb_build_object('ok', false, 'error', 'not_in_setup');
  end if;
  if not exists (select 1 from stations where is_final) then
    return jsonb_build_object('ok', false, 'error', 'no_final_station');
  end if;
  if not exists (select 1 from teams) then
    return jsonb_build_object('ok', false, 'error', 'no_teams');
  end if;
  select count(*) into v_station_count from stations;
  select count(*)::int into v_missing
  from teams t
  where (select count(*) from route_stops rs where rs.team_id = t.id) <> v_station_count;
  if v_missing > 0 then
    return jsonb_build_object('ok', false, 'error', 'teams_missing_routes', 'teams', v_missing);
  end if;
  update game set status = 'live', started_at = now(), ended_at = null where id = 1;
  return jsonb_build_object('ok', true, 'status', 'live');
end;
$$;

create or replace function public.pause_game()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  perform assert_admin();
  select status into v_status from game where id = 1;
  if v_status <> 'live' then
    return jsonb_build_object('ok', false, 'error', 'not_live');
  end if;
  update game set status = 'paused' where id = 1;
  return jsonb_build_object('ok', true, 'status', 'paused');
end;
$$;

create or replace function public.resume_game()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  perform assert_admin();
  select status into v_status from game where id = 1;
  if v_status <> 'paused' then
    return jsonb_build_object('ok', false, 'error', 'not_paused');
  end if;
  update game set status = 'live' where id = 1;
  return jsonb_build_object('ok', true, 'status', 'live');
end;
$$;

create or replace function public.end_game()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  perform assert_admin();
  select status into v_status from game where id = 1;
  if v_status not in ('live', 'paused') then
    return jsonb_build_object('ok', false, 'error', 'not_running');
  end if;
  update game set status = 'ended', ended_at = now() where id = 1;
  return jsonb_build_object('ok', true, 'status', 'ended');
end;
$$;

create or replace function public.reset_progress()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_admin();
  update teams set current_position = 0, finished_at = null where true;
  delete from attempts where true;
  update game set status = 'setup', started_at = null, ended_at = null where id = 1;
  return jsonb_build_object('ok', true, 'status', 'setup');
end;
$$;

-- Admin functions are not callable anonymously
revoke execute on function public.start_game() from public, anon;
revoke execute on function public.pause_game() from public, anon;
revoke execute on function public.resume_game() from public, anon;
revoke execute on function public.end_game() from public, anon;
revoke execute on function public.reset_progress() from public, anon;
grant execute on function public.start_game() to authenticated, service_role;
grant execute on function public.pause_game() to authenticated, service_role;
grant execute on function public.resume_game() to authenticated, service_role;
grant execute on function public.end_game() to authenticated, service_role;
grant execute on function public.reset_progress() to authenticated, service_role;
