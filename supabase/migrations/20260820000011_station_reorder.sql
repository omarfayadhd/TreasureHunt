-- supabase/migrations/20260820000011_station_reorder.sql
-- The ↑/↓ buttons used to issue two separate UPDATEs, which cannot work now
-- that `stations_level_unique` makes sort_order unique and non-deferrable: the
-- first UPDATE collides with the row still holding the target level. Do the
-- whole swap in one transaction, parking one row on a free level first.
--
-- The parking value has to satisfy `stations_level_positive` (sort_order >= 1),
-- so -1 is not usable; the top of the int range is free in practice.
create or replace function public.swap_station_levels(p_a uuid, p_b uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a int;
  v_b int;
  v_status text;
  v_park constant int := 2147483647;
begin
  perform assert_admin();

  select status into v_status from game where id = 1;
  if v_status in ('live', 'paused') then
    return jsonb_build_object('ok', false, 'error', 'game_running');
  end if;

  if p_a is null or p_b is null or p_a = p_b then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Lock both rows in a stable order so two admins cannot deadlock.
  perform 1 from stations where id in (p_a, p_b) order by id for update;

  select sort_order into v_a from stations where id = p_a;
  select sort_order into v_b from stations where id = p_b;
  if v_a is null or v_b is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  update stations set sort_order = v_park where id = p_a;
  update stations set sort_order = v_a where id = p_b;
  update stations set sort_order = v_b where id = p_a;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.swap_station_levels(uuid, uuid) from public, anon;
grant execute on function public.swap_station_levels(uuid, uuid) to authenticated, service_role;
