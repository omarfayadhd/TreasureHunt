-- Each team gets its own route: a code stolen from another team is worthless,
-- and no two teams are ever at the same location at the same level.
create table public.team_stations (
  team_id uuid not null references public.teams (id) on delete cascade,
  level int not null check (level >= 1),
  station_id uuid not null references public.stations (id) on delete restrict,
  code text not null check (code ~ '^[A-Z0-9]{3,12}$'),
  primary key (team_id, level),
  -- a team never revisits a location
  unique (team_id, station_id),
  -- no two teams in the same place at the same level: the staggering rule
  unique (level, station_id),
  -- a code belongs to exactly one team
  unique (code)
);

alter table public.team_stations enable row level security;
create policy "admin full access" on public.team_stations
  for all to authenticated using (true) with check (true);

-- Stations demote to plain locations: no code, no level semantics.
alter table public.stations drop constraint if exists stations_level_unique;
alter table public.stations drop constraint if exists stations_level_positive;
alter table public.stations drop constraint if exists stations_code_format;
alter table public.stations drop column if exists code;
