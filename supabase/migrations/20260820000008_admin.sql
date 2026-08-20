create or replace function public.start_game()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_levels int;
  v_min int;
  v_max int;
  v_teams int;
begin
  perform assert_admin();
  select status into v_status from game where id = 1;
  if v_status <> 'setup' then
    return jsonb_build_object('ok', false, 'error', 'not_in_setup');
  end if;

  select count(*)::int, coalesce(min(sort_order), 0), coalesce(max(sort_order), 0)
  into v_levels, v_min, v_max
  from stations;
  if v_levels = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_stations');
  end if;
  -- Levels must be 1..M with no holes, or a team could hit an unreachable card.
  if v_min <> 1 or v_max <> v_levels then
    return jsonb_build_object('ok', false, 'error', 'level_gap');
  end if;

  select count(*)::int into v_teams from teams;
  if v_teams = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_teams');
  end if;

  update game
  set status = 'live', started_at = now(), ended_at = null, initial_team_count = v_teams
  where id = 1;

  return jsonb_build_object('ok', true, 'status', 'live', 'teams', v_teams, 'levels', v_levels);
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
  -- 'where true' is required: Supabase API sessions load safeupdate, which
  -- rejects WHERE-less UPDATE/DELETE (SQLSTATE 21000) even inside SECURITY DEFINER.
  update teams
  set current_position = 0, finished_at = null, status = 'playing',
      eliminated_at = null, out_at_level = null
  where true;
  delete from card_opens where true;
  delete from attempts where true;
  update game set status = 'setup', started_at = null, ended_at = null, initial_team_count = null
  where id = 1;
  return jsonb_build_object('ok', true, 'status', 'setup');
end;
$$;

-- create or replace function RESETS previously-granted execute privileges to the
-- PUBLIC default, so admin RPCs must have their grants re-applied every time
-- they are replaced.
revoke execute on function public.start_game() from public, anon;
revoke execute on function public.reset_progress() from public, anon;
grant execute on function public.start_game() to authenticated, service_role;
grant execute on function public.reset_progress() to authenticated, service_role;

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
  (select count(*)::int from attempts a where a.team_id = t.id and a.result in ('wrong', 'too_late')) as wrong_count
from teams t;

revoke all on public.admin_monitor from anon;
grant select on public.admin_monitor to authenticated;
