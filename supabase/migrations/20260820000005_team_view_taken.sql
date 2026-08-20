-- `taken` means "how many teams have found this level's code", not how many are
-- merely racing it. Fix: count(current_position >= v_level), no level-1 special case
-- (a fresh current_position = 0 already yields taken = 0 at level 1 for free).
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
  v_alive int;
  v_slots int;
  v_taken int;
  v_race jsonb;
  v_cards jsonb;
  v_place int;
begin
  select * into v_team from teams where id = p_team_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_team_code');
  end if;

  select status into v_status from game where id = 1;
  select count(*)::int into v_total from stations;

  -- Locked cards must not leak clue text anywhere in the payload, not just null it.
  select coalesce(
    jsonb_agg(
      (case when u.unlocked then
        jsonb_build_object(
          'level', s.sort_order,
          'unlocked', true,
          'opened', co.team_id is not null,
          'clue', s.clue_text
        )
      else
        jsonb_build_object(
          'level', s.sort_order,
          'unlocked', false,
          'opened', co.team_id is not null,
          'clue', null
        )
      end)
      order by s.sort_order
    ),
    '[]'::jsonb
  )
  into v_cards
  from stations s
  cross join lateral (
    select (v_status = 'live' and s.sort_order <= v_team.current_position + 1) as unlocked
  ) u
  left join card_opens co on co.team_id = v_team.id and co.level = s.sort_order;

  if v_team.status = 'playing' and v_status = 'live' and v_team.current_position < v_total then
    v_level := v_team.current_position + 1;
    -- Alive means "not eliminated": winners/finishers still hold the slot they took,
    -- so the pool doesn't shrink out from under an in-progress opening race.
    select count(*)::int into v_alive from teams where status <> 'eliminated';
    v_slots := case when v_level <= 1 then v_alive else greatest(v_alive - 1, 1) end;
    select count(*)::int into v_taken from teams where current_position >= v_level;
    v_race := jsonb_build_object('level', v_level, 'slots', v_slots, 'taken', v_taken);
  end if;

  if v_team.status <> 'playing' then
    select count(*)::int + 1 into v_place
    from teams t
    where t.id <> v_team.id
      and (
        (t.finished_at is not null and (v_team.finished_at is null or t.finished_at < v_team.finished_at))
        or (
          t.finished_at is null and v_team.finished_at is null and (
            t.out_at_level > v_team.out_at_level
            or (t.out_at_level = v_team.out_at_level and t.eliminated_at > v_team.eliminated_at)
          )
        )
      );
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
