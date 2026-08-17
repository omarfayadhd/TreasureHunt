-- Single-row game state
create table public.game (
  id int primary key default 1 check (id = 1),
  status text not null default 'setup' check (status in ('setup', 'live', 'paused', 'ended')),
  started_at timestamptz,
  ended_at timestamptz
);
insert into public.game (id) values (1);

-- Physical locations: a clue leads TO the station, the code is posted AT it
create table public.stations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  clue_text text not null,
  code text not null unique,
  is_final boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
-- At most one final (treasure) station
create unique index stations_single_final on public.stations (is_final) where is_final;

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  team_code text not null unique,
  current_position int not null default 0,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

-- Per-team shuffled visiting order; the team's next station is position current_position + 1
create table public.route_stops (
  team_id uuid not null references public.teams (id) on delete cascade,
  position int not null,
  station_id uuid not null references public.stations (id) on delete cascade,
  primary key (team_id, position),
  unique (team_id, station_id)
);

create table public.attempts (
  id bigint generated always as identity primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  submitted_code text not null,
  result text not null check (result in ('correct', 'wrong', 'already_used')),
  created_at timestamptz not null default now()
);
create index attempts_team_created on public.attempts (team_id, created_at desc);

-- Live board realtime feed
alter publication supabase_realtime add table public.teams, public.attempts;
