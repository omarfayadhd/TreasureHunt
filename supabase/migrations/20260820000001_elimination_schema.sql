-- All teams now race the same ladder, so per-team routes are gone.
drop view if exists public.admin_board;
drop function if exists public.generate_routes();
drop function if exists public.set_team_position(uuid, int);
drop table if exists public.route_stops;

-- Stations become levels: contiguous, unique, one per level.
drop index if exists public.stations_single_final;
alter table public.stations drop column if exists is_final;
alter table public.stations
  add constraint stations_level_unique unique (sort_order),
  add constraint stations_level_positive check (sort_order >= 1),
  add constraint stations_code_format check (code ~ '^[A-Z0-9]{3,12}$');

alter table public.teams
  add column status text not null default 'playing'
    check (status in ('playing', 'eliminated', 'winner', 'finished')),
  add column eliminated_at timestamptz,
  add column out_at_level int;

alter table public.game add column initial_team_count int;

alter table public.attempts drop constraint attempts_result_check;
alter table public.attempts
  add constraint attempts_result_check
  check (result in ('correct', 'wrong', 'already_used', 'too_late'));

-- One row per scratched card: the source of truth for "who started" and "how far opened".
create table public.card_opens (
  team_id uuid not null references public.teams (id) on delete cascade,
  level int not null check (level >= 1),
  opened_at timestamptz not null default now(),
  primary key (team_id, level)
);

alter table public.card_opens enable row level security;
create policy "admin full access" on public.card_opens
  for all to authenticated using (true) with check (true);

alter publication supabase_realtime add table public.card_opens, public.game;
