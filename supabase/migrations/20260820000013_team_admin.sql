-- supabase/migrations/20260820000013_team_admin.sql
-- Two problems, one fix.
--
-- 1. Creating, renaming, re-coding and deleting teams were direct table writes
--    under the admin RLS policy, so they bypassed the game-status check that
--    generate_teams has. Mid-hunt, "New code" invalidated a team's printed slip
--    and dropped them at the login screen; Delete cascaded their card_opens and
--    attempts. The spec requires adding or deleting teams to stay blocked while
--    the hunt runs, so the check belongs on the server, not only in the UI.
--
-- 2. Team codes were minted in the browser from a 20-word × 90-number list —
--    1,800 possibilities. team_view is anon-callable with no cooldown, so those
--    codes could be enumerated in seconds, handing an attacker another team's
--    progress and an unearned clue. These RPCs mint codes with the existing
--    collision-checked random_team_code() (32^6 ~= 1.07e9) instead.

create or replace function public.assert_teams_editable()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_status text;
begin
  select status into v_status from game where id = 1;
  if v_status in ('live', 'paused') then
    return 'game_running';
  end if;
  return null;
end;
$$;

create or replace function public.mint_team_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_code text;
begin
  loop
    v_code := random_team_code();
    exit when not exists (select 1 from teams where team_code = v_code);
  end loop;
  return v_code;
end;
$$;

create or replace function public.create_team(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_blocked text;
  v_name text := btrim(coalesce(p_name, ''));
  v_code text;
  v_id uuid;
begin
  perform assert_admin();
  v_blocked := assert_teams_editable();
  if v_blocked is not null then
    return jsonb_build_object('ok', false, 'error', v_blocked);
  end if;
  if v_name = '' then
    return jsonb_build_object('ok', false, 'error', 'bad_name');
  end if;
  if exists (select 1 from teams where name = v_name) then
    return jsonb_build_object('ok', false, 'error', 'name_taken');
  end if;

  v_code := mint_team_code();
  insert into teams (name, team_code) values (v_name, v_code) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'name', v_name, 'team_code', v_code);
end;
$$;

create or replace function public.rename_team(p_team_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_blocked text;
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform assert_admin();
  v_blocked := assert_teams_editable();
  if v_blocked is not null then
    return jsonb_build_object('ok', false, 'error', v_blocked);
  end if;
  if v_name = '' then
    return jsonb_build_object('ok', false, 'error', 'bad_name');
  end if;
  if not exists (select 1 from teams where id = p_team_id) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if exists (select 1 from teams where name = v_name and id <> p_team_id) then
    return jsonb_build_object('ok', false, 'error', 'name_taken');
  end if;

  update teams set name = v_name where id = p_team_id;
  return jsonb_build_object('ok', true, 'name', v_name);
end;
$$;

create or replace function public.regenerate_team_code(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_blocked text;
  v_code text;
begin
  perform assert_admin();
  v_blocked := assert_teams_editable();
  if v_blocked is not null then
    return jsonb_build_object('ok', false, 'error', v_blocked);
  end if;
  if not exists (select 1 from teams where id = p_team_id) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_code := mint_team_code();
  update teams set team_code = v_code where id = p_team_id;
  return jsonb_build_object('ok', true, 'team_code', v_code);
end;
$$;

create or replace function public.delete_team(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_blocked text;
begin
  perform assert_admin();
  v_blocked := assert_teams_editable();
  if v_blocked is not null then
    return jsonb_build_object('ok', false, 'error', v_blocked);
  end if;
  if not exists (select 1 from teams where id = p_team_id) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  delete from teams where id = p_team_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Station codes were minted by the same weak browser generator. They are posted
-- on paper rather than kept secret, but a 1,800-code space is still guessable
-- through submit_code, so suggest them from the same collision-checked pool.
create or replace function public.suggest_station_code()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_code text;
begin
  perform assert_admin();
  loop
    v_code := random_team_code();
    exit when not exists (select 1 from stations where code = v_code);
  end loop;
  return jsonb_build_object('ok', true, 'code', v_code);
end;
$$;

-- create or replace resets execute privileges to the PUBLIC default.
revoke execute on function public.assert_teams_editable() from public, anon;
revoke execute on function public.mint_team_code() from public, anon;
revoke execute on function public.create_team(text) from public, anon;
revoke execute on function public.rename_team(uuid, text) from public, anon;
revoke execute on function public.regenerate_team_code(uuid) from public, anon;
revoke execute on function public.delete_team(uuid) from public, anon;
revoke execute on function public.suggest_station_code() from public, anon;
grant execute on function public.assert_teams_editable() to authenticated, service_role;
grant execute on function public.mint_team_code() to authenticated, service_role;
grant execute on function public.create_team(text) to authenticated, service_role;
grant execute on function public.rename_team(uuid, text) to authenticated, service_role;
grant execute on function public.regenerate_team_code(uuid) to authenticated, service_role;
grant execute on function public.delete_team(uuid) to authenticated, service_role;
grant execute on function public.suggest_station_code() to authenticated, service_role;
