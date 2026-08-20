-- supabase/migrations/20260820000014_generate_teams_names.sql
-- generate_teams looped v_i over (existing + 1)..p_count and inserted
-- 'Team ' || v_i. `teams.name` is unique, so with Team 1 and Team 3 present,
-- generate_teams(3) tried to insert 'Team 3' again and threw teams_name_key.
-- Skip names that are already taken instead, still creating exactly enough
-- teams to reach p_count in total.
--
-- Also refuses while the hunt is paused, not only while it is live — a paused
-- hunt is still mid-game. The error code stays 'game_live' so existing callers
-- keep their copy.
create or replace function public.generate_teams(p_count int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_existing int;
  v_needed int;
  v_created int := 0;
  v_i int := 1;
begin
  perform assert_admin();

  select status into v_status from game where id = 1;
  if v_status in ('live', 'paused') then
    return jsonb_build_object('ok', false, 'error', 'game_live');
  end if;
  if p_count is null or p_count < 1 or p_count > 50 then
    return jsonb_build_object('ok', false, 'error', 'bad_count');
  end if;

  select count(*)::int into v_existing from teams;
  v_needed := greatest(p_count - v_existing, 0);

  while v_created < v_needed loop
    -- Walk past every 'Team N' that already exists, however gappy the numbering.
    while exists (select 1 from teams where name = 'Team ' || v_i) loop
      v_i := v_i + 1;
    end loop;
    insert into teams (name, team_code) values ('Team ' || v_i, mint_team_code());
    v_created := v_created + 1;
    v_i := v_i + 1;
  end loop;

  return jsonb_build_object(
    'ok', true, 'created', v_created, 'total', v_existing + v_created
  );
end;
$$;

-- create or replace resets execute privileges to the PUBLIC default.
revoke execute on function public.generate_teams(int) from public, anon;
grant execute on function public.generate_teams(int) to authenticated, service_role;
