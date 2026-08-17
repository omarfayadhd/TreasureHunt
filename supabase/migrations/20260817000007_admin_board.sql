create view public.admin_board
with (security_invoker = true) as
select
  t.id,
  t.name,
  t.team_code,
  t.current_position,
  t.finished_at,
  t.created_at,
  (select count(*)::int from route_stops rs where rs.team_id = t.id) as total,
  (
    select s.name
    from route_stops rs
    join stations s on s.id = rs.station_id
    where rs.team_id = t.id and rs.position = t.current_position + 1
  ) as next_station,
  (
    select max(a.created_at)
    from attempts a
    where a.team_id = t.id and a.result = 'correct'
  ) as last_solve_at
from teams t;
