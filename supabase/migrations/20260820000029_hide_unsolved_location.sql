-- supabase/migrations/20260820000029_hide_unsolved_location.sql
-- The location a clue points to IS the answer to that clue, and team_view was
-- sending it for the level the team was still hunting: the phone received
-- "Reception desk" alongside the riddle asking where to go, and the card
-- rendered it. Any player opening devtools — or just reading the card — skipped
-- the puzzle entirely.
--
-- A location is now named only for a level the team has already CLEARED. The
-- clue still unlocks a level early (that is the puzzle); the answer arrives only
-- once the code posted there has been typed, which proves the team stood there.
-- The treasure follows the same rule, so its location is never revealed to a
-- team that has not claimed it.
--
-- Locked levels were already null, so this is not a new privilege boundary — it
-- closes a leak inside the levels a team may legitimately see.

create or replace function public.team_view_json(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams%rowtype;
  v_status text;
  v_legs int;
  v_total int;
  v_treasure_id uuid;
  v_treasure stations%rowtype;
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

  select status, treasure_station_id into v_status, v_treasure_id from game where id = 1;
  select count(*)::int into v_legs from team_stations where team_id = p_team_id;
  v_total := v_legs + case when v_treasure_id is null then 0 else 1 end;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'level', ts.level,
        'unlocked', u.unlocked,
        'opened', co.team_id is not null,
        'clue', case when u.unlocked then s.clue_text else null end,
        -- cleared, NOT merely unlocked: the answer follows the solve
        'location', case when u.cleared then s.name else null end
      )
      order by ts.level
    ),
    '[]'::jsonb
  )
  into v_cards
  from team_stations ts
  join stations s on s.id = ts.station_id
  cross join lateral (
    select
      (v_status = 'live' and ts.level <= v_team.current_position + 1) as unlocked,
      (ts.level <= v_team.current_position) as cleared
  ) u
  left join card_opens co on co.team_id = v_team.id and co.level = ts.level
  where ts.team_id = v_team.id;

  if v_treasure_id is not null then
    select * into v_treasure from stations where id = v_treasure_id;
    v_cards := v_cards || jsonb_build_array(jsonb_build_object(
      'level', v_legs + 1,
      'unlocked', v_status = 'live' and v_legs + 1 <= v_team.current_position + 1,
      'opened', exists (
        select 1 from card_opens co where co.team_id = v_team.id and co.level = v_legs + 1
      ),
      'clue', case
        when v_status = 'live' and v_legs + 1 <= v_team.current_position + 1 then v_treasure.clue_text
        else null end,
      -- Only the team that claimed the treasure is ever told where it was.
      'location', case when v_legs + 1 <= v_team.current_position then v_treasure.name else null end
    ));
  end if;

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

revoke execute on function public.team_view_json(uuid) from public, anon;
grant execute on function public.team_view_json(uuid) to authenticated, service_role;
