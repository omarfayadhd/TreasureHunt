-- supabase/migrations/20260820000015_wrong_count.sql
-- admin_monitor.wrong_count summed result in ('wrong', 'too_late'). Revision 2
-- never records 'too_late' — nothing times a team out any more — so the extra
-- term is dead weight that reads as if the column meant something wider than
-- "codes this team got wrong". Count only 'wrong'.
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
  (select count(*)::int from attempts a where a.team_id = t.id and a.result = 'wrong') as wrong_count
from teams t;

revoke all on public.admin_monitor from anon;
grant select on public.admin_monitor to authenticated;
