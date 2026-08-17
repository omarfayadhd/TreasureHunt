alter table public.game enable row level security;
alter table public.stations enable row level security;
alter table public.teams enable row level security;
alter table public.route_stops enable row level security;
alter table public.attempts enable row level security;

-- Only admins sign in; players go through SECURITY DEFINER RPCs and get no policies at all.
create policy "admin full access" on public.game
  for all to authenticated using (true) with check (true);
create policy "admin full access" on public.stations
  for all to authenticated using (true) with check (true);
create policy "admin full access" on public.teams
  for all to authenticated using (true) with check (true);
create policy "admin full access" on public.route_stops
  for all to authenticated using (true) with check (true);
create policy "admin full access" on public.attempts
  for all to authenticated using (true) with check (true);
