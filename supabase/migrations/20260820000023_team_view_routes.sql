-- supabase/migrations/20260820000023_team_view_routes.sql
-- team_view_json reads the calling team's own route out of team_stations
-- instead of the shared stations ladder. Levels, clues and the card count all
-- come from that team's rows, and an unlocked card now names its location.
--
-- Numbered 23 (not 18 as the plan sketched) so it sorts after the highest
-- already-applied migration: a version lower than one on a deployed database
-- is skipped by `supabase db push` unless forced.

create or replace function public.team_view_json(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams%rowtype;
  v_status text;
  v_total int;
  v_level int;
  v_found int;
  v_teams int;
  v_race jsonb;
  v_cards jsonb;
  v_place int;
begin
  select * into v_team from teams where id = p_team_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_team_code');
  end if;

  select status into v_status from game where id = 1;
  select count(*)::int into v_total from team_stations where team_id = p_team_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'level', ts.level,
        'unlocked', u.unlocked,
        'opened', co.team_id is not null,
        'clue', case when u.unlocked then s.clue_text else null end,
        'location', case when u.unlocked then s.name else null end
      )
      order by ts.level
    ),
    '[]'::jsonb
  )
  into v_cards
  from team_stations ts
  join stations s on s.id = ts.station_id
  cross join lateral (
    select (v_status = 'live' and ts.level <= v_team.current_position + 1) as unlocked
  ) u
  left join card_opens co on co.team_id = v_team.id and co.level = ts.level
  where ts.team_id = v_team.id;

  -- Progress info only: a full `found` never blocks anyone.
  if v_team.status = 'playing' and v_status = 'live' and v_team.current_position < v_total then
    v_level := v_team.current_position + 1;
    select count(*)::int into v_found from teams where current_position >= v_level;
    select count(*)::int into v_teams from teams;
    v_race := jsonb_build_object('level', v_level, 'found', v_found, 'teams', v_teams);
  end if;

  if v_team.finished_at is not null then
    select count(*)::int + 1 into v_place
    from teams t
    where t.id <> v_team.id
      and t.finished_at is not null
      and t.finished_at < v_team.finished_at;
  end if;

  return jsonb_build_object(
    'ok', true,
    'team_name', v_team.name,
    'game_status', v_status,
    'status', v_team.status,
    'cleared', v_team.current_position,
    'total', v_total,
    'out_at_level', v_team.out_at_level,
    'place', v_place,
    'race', v_race,
    'cards', v_cards
  );
end;
$$;

-- Players never call this directly: team_view(p_team_code) is the anon entry point.
revoke execute on function public.team_view_json(uuid) from public, anon;
grant execute on function public.team_view_json(uuid) to authenticated, service_role;

-- open_card read the clue off the shared ladder (`stations where sort_order =
-- p_level`), which is now meaningless: the location at a level differs per team,
-- and stations.sort_order is display order only. Read the caller's own route.
-- (The plan's task list named team_view and submit_code; open_card is the third
-- player RPC on the same shared-ladder read and has to move with them.)
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

  select s.clue_text into v_clue
  from team_stations ts
  join stations s on s.id = ts.station_id
  where ts.team_id = v_team.id and ts.level = p_level;
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

grant execute on function public.open_card(text, int) to anon, authenticated, service_role;
