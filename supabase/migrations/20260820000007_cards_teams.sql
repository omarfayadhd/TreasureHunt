-- supabase/migrations/20260820000007_cards_teams.sql

-- Scratching a card always goes through the server, so a locked clue can never
-- be revealed by poking at the canvas.
create or replace function public.open_card(p_team_code text, p_level int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams%rowtype;
  v_status text;
  v_clue text;
begin
  select * into v_team from teams where team_code = normalize_code(p_team_code);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_team_code');
  end if;

  select status into v_status from game where id = 1;
  if v_status <> 'live' then
    return jsonb_build_object('ok', false, 'error', 'game_not_live');
  end if;

  if p_level is null or p_level < 1 or p_level > v_team.current_position + 1 then
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;

  select clue_text into v_clue from stations where sort_order = p_level;
  if v_clue is null then
    return jsonb_build_object('ok', false, 'error', 'no_such_level');
  end if;

  insert into card_opens (team_id, level) values (v_team.id, p_level)
  on conflict (team_id, level) do nothing;

  return jsonb_build_object(
    'ok', true, 'level', p_level, 'clue', v_clue, 'view', team_view_json(v_team.id)
  );
end;
$$;

-- Admin types a team count; names are Team 1..N and codes are collision-checked.
create or replace function public.generate_teams(p_count int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_existing int;
  v_created int := 0;
  v_code text;
  v_i int;
begin
  perform assert_admin();

  select status into v_status from game where id = 1;
  if v_status = 'live' then
    return jsonb_build_object('ok', false, 'error', 'game_live');
  end if;
  if p_count is null or p_count < 1 or p_count > 50 then
    return jsonb_build_object('ok', false, 'error', 'bad_count');
  end if;

  select count(*)::int into v_existing from teams;

  for v_i in (v_existing + 1)..p_count loop
    loop
      v_code := random_team_code();
      exit when not exists (select 1 from teams where team_code = v_code);
    end loop;
    insert into teams (name, team_code) values ('Team ' || v_i, v_code);
    v_created := v_created + 1;
  end loop;

  return jsonb_build_object(
    'ok', true, 'created', v_created, 'total', greatest(v_existing, p_count)
  );
end;
$$;

grant execute on function public.open_card(text, int) to anon, authenticated, service_role;
revoke execute on function public.generate_teams(int) from public, anon;
grant execute on function public.generate_teams(int) to authenticated, service_role;
