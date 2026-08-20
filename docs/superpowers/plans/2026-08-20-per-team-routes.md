# Per-Team Routes & Per-Team Codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every team its own route through a shared pool of locations, with its own code at each stop, so teams never occupy the same place at the same level and a code stolen from another team is worthless.

**Architecture:** One new table, `team_stations(team_id, level, station_id, code)`, carries the whole feature; its four unique constraints encode the rules so an invalid rotation cannot be saved even if the UI is bypassed. `stations` demotes to a plain location (name, clue, display order). The three player RPCs are rewritten to read the caller's own route instead of a shared ladder, and the admin station setup page gains a teams x levels route grid beneath its locations list — no new page, no new nav entry.

**Tech Stack:** Postgres 15 (Supabase), plpgsql, React 18 + TypeScript, Vite, React Router 6, Vitest + Testing Library (unit) and Vitest + supabase-js against a local Supabase stack (integration), plain CSS.

**Spec:** `docs/superpowers/specs/2026-08-20-per-team-routes-design.md`

## Global Constraints

- A code belongs to exactly one team. `submit_code` only ever compares against `team_stations` rows for the calling team.
- The staggering rule is `unique (level, station_id)`: two teams may never share a location at the same level, but the same location serves different teams at different levels.
- A team never revisits a location: `unique (team_id, station_id)`.
- Codes are globally unique and match `^[A-Z0-9]{3,12}$`. They come from the existing collision-checked `random_team_code()` / `mint_team_code()` server generator — never from client-side generation.
- `S >= T` (locations at least teams) and `M <= S` (levels at most locations); every team has the same `M`.
- Winning is unchanged: no elimination, first finisher is `winner` (decided under the game-row lock using `clock_timestamp()`), later finishers are `finished` and placed by `finished_at`.
- Migrations are append-only under `supabase/migrations/`, continuing from `20260820000015`. Never edit a shipped migration. **Every `create or replace function` resets grants to include PUBLIC — re-apply `revoke execute … from public, anon` / `grant execute … to …` in the same migration.** This project has been bitten by that four times.
- Every admin RPC calls `assert_admin()` first and refuses while `game.status` is `live` or `paused`.
- Any `UPDATE`/`DELETE` inside an RPC needs an explicit `where` (even `where true`) — `safeupdate` rejects WHERE-less DML with SQLSTATE 21000.
- Repo style: 2-space indent, no trailing semicolons, single quotes, `export function` declarations.
- Unit tests: `npx vitest run src`. Integration: `npx vitest run tests/integration --no-file-parallelism`.

## File Structure

**Created:** `supabase/migrations/20260820000016_team_stations.sql`, `…0017_seed_routes.sql`, `…0018_team_view_routes.sql`, `…0019_submit_code_routes.sql`, `…0020_start_game_routes.sql`, `…0021_route_admin.sql`; `src/admin/RouteGrid.tsx` + test (a component rendered BY the stations page, not a new route); `tests/integration/routes.test.ts`.

**Modified:** `src/lib/api.ts` (Card gains `location`, submit reason gains `not_your_code`), `src/player/usePlayerGame.ts`, `src/player/CardGrid.tsx` + `ScratchCard.tsx` (show location), `src/player/PlayerApp.test.tsx`, `src/admin/adminApi.ts`, `src/admin/StationsPanel.tsx` (+ test) (drop code and level columns, host the route grid), `src/admin/PrintPage.tsx` (+ test) (group by location), `src/admin/Dashboard.tsx` (+ test) (`current_location`), `tests/integration/helpers.ts`, `tests/integration/submit-code.test.ts`, `tests/integration/team-view.test.ts`, `tests/integration/game-lifecycle.test.ts`, `tests/integration/schema.test.ts`, `README.md`.

---

## Task 1: `team_stations` schema

**Files:** Create `supabase/migrations/20260820000016_team_stations.sql`; modify `tests/integration/helpers.ts`, `tests/integration/schema.test.ts`.

**Interfaces:**
- Produces table `team_stations(team_id uuid, level int, station_id uuid, code text)` with PK `(team_id, level)` and uniques `(team_id, station_id)`, `(level, station_id)`, `(code)`; RLS admin-only. `stations` loses `code` and its three level/code constraints.
- Helper `seedStations(service, count)` now creates locations WITHOUT codes and returns `{id, name, clue_text, sort_order}`. New helper `setRoute(service, teamId, [{level, stationId, code}])` inserts route rows.

- [ ] **Step 1: Write the failing test** — add to `tests/integration/schema.test.ts`:

```ts
describe('team_stations', () => {
  it('refuses two teams at the same location on the same level', async () => {
    const [s1] = await seedStations(service, 2)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    const b = await createTeam(service, 'Team 2', 'BETA22')
    await setRoute(service, a.id, [{ level: 1, stationId: s1.id, code: 'AAA111' }])
    const { error } = await service
      .from('team_stations')
      .insert({ team_id: b.id, level: 1, station_id: s1.id, code: 'BBB222' })
    expect(error?.message).toMatch(/duplicate key|unique/i)
  })

  it('allows the same location for another team at a different level', async () => {
    const [s1] = await seedStations(service, 2)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    const b = await createTeam(service, 'Team 2', 'BETA22')
    await setRoute(service, a.id, [{ level: 1, stationId: s1.id, code: 'AAA111' }])
    const { error } = await service
      .from('team_stations')
      .insert({ team_id: b.id, level: 2, station_id: s1.id, code: 'BBB222' })
    expect(error).toBeNull()
  })

  it('refuses a team revisiting a location', async () => {
    const [s1] = await seedStations(service, 2)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    await setRoute(service, a.id, [{ level: 1, stationId: s1.id, code: 'AAA111' }])
    const { error } = await service
      .from('team_stations')
      .insert({ team_id: a.id, level: 2, station_id: s1.id, code: 'CCC333' })
    expect(error?.message).toMatch(/duplicate key|unique/i)
  })

  it('refuses a duplicate code across teams', async () => {
    const [s1, s2] = await seedStations(service, 2)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    const b = await createTeam(service, 'Team 2', 'BETA22')
    await setRoute(service, a.id, [{ level: 1, stationId: s1.id, code: 'SAME11' }])
    const { error } = await service
      .from('team_stations')
      .insert({ team_id: b.id, level: 1, station_id: s2.id, code: 'SAME11' })
    expect(error?.message).toMatch(/duplicate key|unique/i)
  })

  it('refuses a malformed code', async () => {
    const [s1] = await seedStations(service, 1)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    const { error } = await service
      .from('team_stations')
      .insert({ team_id: a.id, level: 1, station_id: s1.id, code: 'no good!' })
    expect(error?.message).toMatch(/code/i)
  })

  it('cascades a route away with its team but protects a location in use', async () => {
    const [s1] = await seedStations(service, 1)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    await setRoute(service, a.id, [{ level: 1, stationId: s1.id, code: 'AAA111' }])
    const { error: stationError } = await service.from('stations').delete().eq('id', s1.id)
    expect(stationError).not.toBeNull()
    await service.from('teams').delete().eq('id', a.id)
    const { data } = await service.from('team_stations').select('*')
    expect(data).toEqual([])
  })

  it('no longer has a code column on stations', async () => {
    const { error } = await service.from('stations').select('code').limit(1)
    expect(error).not.toBeNull()
  })
})
```

- [ ] **Step 2: Update the helpers**

```ts
export type SeededStation = { id: string; name: string; clue_text: string; sort_order: number }

/** Creates `count` locations. Locations no longer carry codes or levels. */
export async function seedStations(service: SupabaseClient, count: number): Promise<SeededStation[]> {
  const rows = Array.from({ length: count }, (_, i) => ({
    name: `Station ${i + 1}`,
    clue_text: `Clue leading to station ${i + 1}`,
    sort_order: i + 1,
  }))
  const { data, error } = await service.from('stations').insert(rows).select()
  if (error) throw new Error(error.message)
  return (data as SeededStation[]).sort((a, b) => a.sort_order - b.sort_order)
}

export async function setRoute(
  service: SupabaseClient,
  teamId: string,
  cells: { level: number; stationId: string; code: string }[],
): Promise<void> {
  const rows = cells.map(c => ({ team_id: teamId, level: c.level, station_id: c.stationId, code: c.code }))
  const { error } = await service.from('team_stations').insert(rows)
  if (error) throw new Error(error.message)
}
```

Add `team_stations` to `resetDb`'s delete list, before `teams` and `stations`.

- [ ] **Step 3: Run and confirm failure** — `npx vitest run tests/integration/schema.test.ts`; expect `team_stations` missing.

- [ ] **Step 4: Write the migration**

```sql
-- supabase/migrations/20260820000016_team_stations.sql

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
```

- [ ] **Step 5: Verify** — `npx supabase db reset && npx vitest run tests/integration/schema.test.ts`. Other suites will fail until Tasks 3-5; report, don't fix.

- [ ] **Step 6: Commit** — `git commit -m "feat: per-team route table, stations demote to locations"`

---

## Task 2: Seed the existing game's routes

**Files:** Create `supabase/migrations/20260820000017_seed_routes.sql`; Test `tests/integration/routes.test.ts` (new).

**Interfaces:** Consumes `team_stations` and the existing `mint_team_code()`/`random_team_code()`. Produces nothing new — a one-time data migration that must be safe on an empty database too.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/routes.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { createTeam, resetDb, seedStations, serviceClient } from './helpers'

const service = serviceClient()
beforeEach(async () => { await resetDb(service) })

describe('route seeding helper', () => {
  it('builds a valid rotation for every team with no collisions', async () => {
    const stations = await seedStations(service, 3)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    const b = await createTeam(service, 'Team 2', 'BETA22')

    const { error } = await service.rpc('seed_missing_routes')
    expect(error).toBeNull()

    const { data } = await service.from('team_stations').select('team_id, level, station_id, code')
    const rows = data as { team_id: string; level: number; station_id: string; code: string }[]
    expect(rows).toHaveLength(6)
    for (const team of [a.id, b.id]) {
      const mine = rows.filter(r => r.team_id === team)
      expect(mine.map(r => r.level).sort()).toEqual([1, 2, 3])
      expect(new Set(mine.map(r => r.station_id)).size).toBe(3)
    }
    for (const level of [1, 2, 3]) {
      const atLevel = rows.filter(r => r.level === level)
      expect(new Set(atLevel.map(r => r.station_id)).size).toBe(atLevel.length)
    }
    expect(new Set(rows.map(r => r.code)).size).toBe(6)
    expect(stations).toHaveLength(3)
  })

  it('is a no-op when routes already exist', async () => {
    await seedStations(service, 2)
    await createTeam(service, 'Team 1', 'ALPHA1')
    await service.rpc('seed_missing_routes')
    const before = (await service.from('team_stations').select('code')).data
    await service.rpc('seed_missing_routes')
    const after = (await service.from('team_stations').select('code')).data
    expect(after).toEqual(before)
  })

  it('refuses when there are fewer locations than teams', async () => {
    await seedStations(service, 1)
    await createTeam(service, 'Team 1', 'ALPHA1')
    await createTeam(service, 'Team 2', 'BETA22')
    const { data } = await service.rpc('seed_missing_routes')
    expect(data).toMatchObject({ ok: false, error: 'not_enough_locations' })
  })
})
```

- [ ] **Step 2: Run and confirm failure** — the RPC does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260820000017_seed_routes.sql
-- Builds a staggered rotation for any team that has no route yet: team i takes
-- the locations rotated by i, so no two teams share a location at one level.
-- Safe on an empty database and a no-op once routes exist.

create or replace function public.seed_missing_routes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stations uuid[];
  v_teams uuid[];
  v_s int;
  v_t int;
  v_i int;
  v_level int;
  v_code text;
begin
  select array_agg(id order by sort_order, id) into v_stations from stations;
  select array_agg(id order by created_at, id) into v_teams
  from teams t where not exists (select 1 from team_stations ts where ts.team_id = t.id);

  v_s := coalesce(array_length(v_stations, 1), 0);
  v_t := coalesce(array_length(v_teams, 1), 0);
  if v_t = 0 then
    return jsonb_build_object('ok', true, 'created', 0);
  end if;
  if v_s = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_locations');
  end if;
  if v_s < (select count(*) from teams) then
    return jsonb_build_object('ok', false, 'error', 'not_enough_locations');
  end if;

  for v_i in 1..v_t loop
    for v_level in 1..v_s loop
      -- rotate: team i starts at location i and wraps around
      v_code := mint_team_code();
      insert into team_stations (team_id, level, station_id, code)
      values (
        v_teams[v_i],
        v_level,
        v_stations[1 + ((v_level - 1 + v_i - 1) % v_s)],
        v_code
      );
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'created', v_t * v_s);
end;
$$;

revoke execute on function public.seed_missing_routes() from public, anon;
grant execute on function public.seed_missing_routes() to authenticated, service_role;

-- Seed the game that exists right now (no-op on a fresh database).
select public.seed_missing_routes();
```

If `mint_team_code()` is not the generator's name in this repo, use whatever the collision-checked minting function is called — check `supabase/migrations/20260820000013_team_admin.sql`.

- [ ] **Step 4: Verify** — `npx supabase db reset && npx vitest run tests/integration/routes.test.ts` (3 cases).

- [ ] **Step 5: Commit** — `git commit -m "feat: seed staggered routes for existing teams"`

---

## Task 3: `team_view` reads the team's own route

**Files:** Create `supabase/migrations/20260820000018_team_view_routes.sql`; modify `tests/integration/team-view.test.ts`.

**Interfaces:** `team_view_json(uuid)` unchanged in shape except each card gains `location` (string, non-null only for unlocked levels), `total` = the team's own level count, `race.found` counts teams with `current_position >= level`.

- [ ] **Step 1: Update the tests** — every case that seeded a shared ladder now seeds locations plus an explicit route. Replace the card/lock cases with:

```ts
  it('returns one card per route level with only the first unlocked', async () => {
    const stations = await seedStations(service, 3)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    await setRoute(service, a.id, [
      { level: 1, stationId: stations[0].id, code: 'AAA111' },
      { level: 2, stationId: stations[1].id, code: 'AAA222' },
      { level: 3, stationId: stations[2].id, code: 'AAA333' },
    ])
    await setGameStatus(service, 'live')

    const result = await view('ALPHA1')
    expect(result.total).toBe(3)
    expect(result.cards.map(c => c.unlocked)).toEqual([true, false, false])
    expect(result.cards[0].location).toBe('Station 1')
    expect(result.cards[1].location).toBeNull()
    expect(JSON.stringify(result)).not.toContain('station 2')
  })

  it('shows each team its own route, not another team's', async () => {
    const stations = await seedStations(service, 2)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    const b = await createTeam(service, 'Team 2', 'BETA22')
    await setRoute(service, a.id, [{ level: 1, stationId: stations[0].id, code: 'AAA111' }])
    await setRoute(service, b.id, [{ level: 1, stationId: stations[1].id, code: 'BBB111' }])
    await setGameStatus(service, 'live')

    expect((await view('ALPHA1')).cards[0].location).toBe('Station 1')
    expect((await view('BETA22')).cards[0].location).toBe('Station 2')
  })
```

Keep the pre-live lock case, the eliminated→finished place case and the race cases, adjusting their setup to use `setRoute`.

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Write the migration** — `create or replace function public.team_view_json(p_team_id uuid)` identical to the shipped version except the cards query, which becomes:

```sql
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
```

and `v_total` becomes `select count(*)::int into v_total from team_stations where team_id = p_team_id;`. End the migration with `revoke execute on function public.team_view_json(uuid) from public, anon;`.

- [ ] **Step 4: Verify** — `npx supabase db reset && npx vitest run tests/integration/team-view.test.ts`.

- [ ] **Step 5: Commit** — `git commit -m "feat: team_view serves each team its own route"`

---

## Task 4: `submit_code` validates the team's own code

**Files:** Create `supabase/migrations/20260820000019_submit_code_routes.sql`; modify `tests/integration/submit-code.test.ts`.

**Interfaces:** `submit_code` returns `reason` in `'wrong' | 'already_used' | 'not_your_code'`. `attempts.result` accepts `'not_your_code'`.

- [ ] **Step 1: Update the tests** — reseed with per-team routes, and add the case that is the whole point:

```ts
  it('rejects another team's code without advancing anyone', async () => {
    const { a, b } = await twoTeamGame()   // A: level1 code AAA111, B: level1 code BBB111
    const result = await submit('ALPHA1', 'BBB111')
    expect(result).toMatchObject({ ok: true, correct: false, reason: 'not_your_code' })
    expect((await teamRow(a.id)).current_position).toBe(0)
    expect((await teamRow(b.id)).current_position).toBe(0)
    const { data } = await service.from('attempts').select('result').eq('team_id', a.id)
    expect(data).toEqual([{ result: 'not_your_code' }])
  })

  it('accepts each team's own code for the same level', async () => {
    const { a, b } = await twoTeamGame()
    expect(await submit('ALPHA1', 'AAA111')).toMatchObject({ correct: true })
    expect(await submit('BETA22', 'BBB111')).toMatchObject({ correct: true })
    expect((await teamRow(a.id)).current_position).toBe(1)
    expect((await teamRow(b.id)).current_position).toBe(1)
  })
```

Keep and re-seed: wrong code, already-used (own earlier level), cooldown, paused, not_playing, the winner/placement cases and the concurrent-final-level race.

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Write the migration** — extend the `attempts.result` check to add `'not_your_code'`, then `create or replace function public.submit_code(p_team_code text, p_code text)` as shipped, replacing the code-matching block with:

```sql
  select count(*)::int into v_total from team_stations where team_id = v_team.id;
  v_level := v_team.current_position + 1;

  -- one of this team's own earlier codes
  if exists (
    select 1 from team_stations
    where team_id = v_team.id and level <= v_team.current_position and code = v_code
  ) then
    insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'already_used');
    return jsonb_build_object('ok', true, 'correct', false, 'reason', 'already_used',
                              'view', team_view_json(v_team.id));
  end if;

  select code into v_expected from team_stations where team_id = v_team.id and level = v_level;

  if v_expected is distinct from v_code then
    -- a real code, but issued to somebody else
    if exists (select 1 from team_stations where code = v_code and team_id <> v_team.id) then
      insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'not_your_code');
      return jsonb_build_object('ok', true, 'correct', false, 'reason', 'not_your_code',
                                'view', team_view_json(v_team.id));
    end if;
    insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'wrong');
    return jsonb_build_object('ok', true, 'correct', false, 'reason', 'wrong',
                              'view', team_view_json(v_team.id));
  end if;
```

The rest — cooldown, the final-level branch with the game-row lock and `clock_timestamp()`, the grant — is unchanged. Re-apply `grant execute on function public.submit_code(text, text) to anon, authenticated, service_role;`.

- [ ] **Step 4: Verify** — `npx supabase db reset && npx vitest run tests/integration --no-file-parallelism`.

- [ ] **Step 5: Commit** — `git commit -m "feat: codes are team-specific, with a not_your_code answer"`

---

## Task 5: Kickoff guards and the monitor's location column

**Files:** Create `supabase/migrations/20260820000020_start_game_routes.sql`; modify `tests/integration/game-lifecycle.test.ts`, `tests/integration/admin-monitor.test.ts`.

**Interfaces:** `start_game` errors gain `route_incomplete`, `route_length_mismatch`, `not_enough_locations` and lose `level_gap`. `admin_monitor` gains `current_location text`.

- [ ] **Step 1: Write the tests** — each guard rejected, a valid rotation accepted with `initial_team_count` snapshotted, and:

```ts
  it('reports the location each team is hunting', async () => {
    // team at current_position 1 of a 3-level route -> hunting its level 2 location
    const admin = await adminClient()
    const { data } = await admin.from('admin_monitor').select('name, current_location').order('name')
    expect(data).toMatchObject([{ name: 'Team 1', current_location: 'Station 2' }])
  })
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Write the migration** — replace the station-level checks in `start_game` with:

```sql
  select count(*)::int into v_locations from stations;
  select count(*)::int into v_teams from teams;
  if v_locations = 0 then return jsonb_build_object('ok', false, 'error', 'no_stations'); end if;
  if v_teams = 0 then return jsonb_build_object('ok', false, 'error', 'no_teams'); end if;
  if v_locations < v_teams then
    return jsonb_build_object('ok', false, 'error', 'not_enough_locations',
                              'locations', v_locations, 'teams', v_teams);
  end if;

  -- every team needs levels 1..M with no gaps
  select t.name into v_bad_team
  from teams t
  left join team_stations ts on ts.team_id = t.id
  group by t.id, t.name
  having count(ts.level) = 0
      or count(ts.level) <> max(ts.level)
      or min(ts.level) <> 1
  limit 1;
  if v_bad_team is not null then
    return jsonb_build_object('ok', false, 'error', 'route_incomplete', 'team', v_bad_team);
  end if;

  -- and every team's M must match
  select count(distinct c) into v_lengths from (
    select count(*) as c from team_stations group by team_id
  ) counts;
  if v_lengths > 1 then
    return jsonb_build_object('ok', false, 'error', 'route_length_mismatch');
  end if;

  select count(*)::int into v_levels from team_stations
  where team_id = (select id from teams order by created_at limit 1);
```

returning `{ok:true, status:'live', teams:v_teams, levels:v_levels}`. Then recreate `admin_monitor` with

```sql
  (select s.name from team_stations ts join stations s on s.id = ts.station_id
    where ts.team_id = t.id and ts.level = t.current_position + 1) as current_location,
```

and re-apply the view's `revoke all … from anon` / `grant select … to authenticated`, plus the function grants.

- [ ] **Step 4: Verify** — full integration suite green.

- [ ] **Step 5: Commit** — `git commit -m "feat: kickoff validates routes; monitor shows current location"`

---

## Task 6: Route-editing RPCs and the client API

**Files:** Create `supabase/migrations/20260820000021_route_admin.sql`; modify `src/admin/adminApi.ts`, `src/lib/api.ts`, `src/player/usePlayerGame.ts`; test additions in `tests/integration/routes.test.ts`.

**Interfaces:**
- SQL: `set_route_cell(p_team_id uuid, p_level int, p_station_id uuid) -> jsonb`, `set_route_code(p_team_id uuid, p_level int) -> jsonb`, `clear_route_cell(p_team_id uuid, p_level int) -> jsonb`. Each is admin-only and refuses while the game runs (`game_running`). `set_route_cell` upserts and mints a code when the cell has none; it returns `{ok:false, error:'location_taken_at_level'|'location_used_by_team'}` instead of a raw constraint error.
- TS: `type RouteCell = { team_id: string; level: number; station_id: string; code: string }`, `fetchRoutes(): Promise<RouteCell[]>`, `setRouteCell`, `setRouteCode`, `clearRouteCell`. `Card` gains `location: string | null`; the submit `reason` union gains `'not_your_code'`; `Feedback` gains the same.

- [ ] **Step 1: Write integration tests** for each RPC: happy path, both collision errors surfaced as readable codes rather than SQL text, refusal while live, and anon refusal (expect 42501).

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Write the migration.** Each function: `perform assert_admin()`, refuse when `game.status in ('live','paused')`, then act. In `set_route_cell`, pre-check the two collisions explicitly so the caller gets `location_taken_at_level` / `location_used_by_team`, and wrap the insert/update in an exception handler mapping `unique_violation` to the same codes. Revoke from `public, anon`, grant to `authenticated, service_role`.

- [ ] **Step 4: Extend the client API** — the three admin wrappers plus the two type widenings. In `CardGrid.tsx`, add the `not_your_code` branch to the feedback switch with copy: `That code belongs to another team.`

- [ ] **Step 5: Verify** — `npx vitest run src` and the integration suite; `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit** — `git commit -m "feat: route-editing RPCs and client wiring"`

---

## Task 7: Team-route grid inside the station setup page

**Files:** Create `src/admin/RouteGrid.tsx`, `src/admin/RouteGrid.test.tsx`; modify `src/admin/StationsPanel.tsx` and `src/admin/StationsPanel.test.tsx`.

**This is the station setup screen, not a new page.** Do NOT add a nav entry or a router route — `StationsPanel` renders `RouteGrid` beneath its locations list. The admin sets up stations in one place.

**Interfaces:** `<RouteGrid teams={{id,name}[]} stations={StationRow[]} rows={RouteCell[]} disabled={boolean} onReload={() => void} />`. It consumes `setRouteCell`, `setRouteCode`, `clearRouteCell` from `adminApi` directly and calls `onReload` after a successful write.

- [ ] **Step 1: Write the failing test** (`RouteGrid.test.tsx`) — cases:
  - renders a cell's location name and code for a given team and level;
  - choosing a location in a cell calls `setRouteCell(teamId, level, stationId)`;
  - the "new code" button calls `setRouteCode(teamId, level)`;
  - a `location_taken_at_level` result renders readable copy, e.g. `Station 1 is already another team's level 2 stop.` — not a raw constraint string;
  - a `location_used_by_team` result renders `Team 1 already visits Station 1 at another level.`;
  - every control is disabled when `disabled` is true;
  - the validation summary lists empty cells by team and level, flags route lengths that differ, and flags fewer locations than teams.

- [ ] **Step 2: Run and confirm failure** — `npx vitest run src/admin/RouteGrid.test.tsx`.

- [ ] **Step 3: Build `RouteGrid`** — a table: one row per team, one column per level (columns = longest route length, plus one trailing empty column to extend every route). Each cell holds a `<select>` of locations (blank option = clear the cell, calling `clearRouteCell`) and, when a code exists, the code in `--font-mono` with a small "new code" button. Derive the validation summary from `rows`/`teams`/`stations` in a pure helper exported for direct unit testing, e.g. `routeIssues(teams, stations, rows): string[]`.

- [ ] **Step 4: Host it in the station setup page** — in `StationsPanel.tsx`, after the locations list, render a `<h2>Team routes</h2>` section containing `<RouteGrid …/>`. Load teams (`fetchMonitor` gives `id`+`name`) and routes (`fetchRoutes`) alongside the existing stations fetch, pass `disabled={gameRunning}`, and pass `onReload` so a cell edit refreshes the grid. Update `StationsPanel.test.tsx` to stub the new API calls and assert the section renders.

- [ ] **Step 5: Verify** — `npx vitest run src/admin`; `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit** — `git commit -m "feat: team-route grid in the station setup page"`

---

## Task 8: Print, stations page, dashboard, docs, full verification

**Files:** Modify `src/admin/PrintPage.tsx` (+ test), `src/admin/StationsPanel.tsx` (+ test), `src/admin/Dashboard.tsx` (+ test), `src/player/CardGrid.tsx`/`ScratchCard.tsx` (+ `PlayerApp.test.tsx`), `README.md`.

- [ ] **Step 1: Print regroups by location.** One section per location, listing every team's slip for that place: location name as the heading, then per team a card with the team name and its code in large monospace. Add a per-team clue sheet section as today. Test: two teams and two locations produce two location sections, each containing both team names, and each code appears exactly once.

- [ ] **Step 2: Trim the locations list** — in the same `StationsPanel`, drop the code column, the code input and its validation, and the level column and contiguity warning (routes own levels now). Keep name, clue, display order and the reorder controls, above the route grid added in Task 7. Update its tests.

- [ ] **Step 3: Dashboard** shows `current_location` in a new column, rendering `—` when a team has finished. Update its test.

- [ ] **Step 4: Player card** shows the location name for unlocked cards alongside the clue (`card.location`), and the `not_your_code` message appears in `CardGrid`. Update `PlayerApp.test.tsx`.

- [ ] **Step 5: README** — rewrite the rules and runbook: locations pool, per-team routes and codes, the staggering rule, at least as many locations as teams, the admin flow (teams → locations → Routes grid → print grouped by location → start), and that a code from another team is refused.

- [ ] **Step 6: Full verification** — all four gates:

```
npx tsc --noEmit
npx vitest run src
npx supabase db reset && npx vitest run tests/integration --no-file-parallelism
npm run build
```

- [ ] **Step 7: Play one game by hand** — two teams, three locations, staggered routes. Confirm each team sees its own location, a code from the other team returns "belongs to another team" without advancing anyone, both teams can clear the same location at different levels, and the first to finish is the winner with the second placed 2nd.

- [ ] **Step 8: Commit** — `git commit -m "feat: print by location, docs and final verification"`

---

## Self-Review

**Spec coverage:** `team_stations` and its four constraints (Task 1); the data migration for the live game (Task 2); `team_view` per-team cards with `location` (Task 3); per-team code validation and `not_your_code` (Task 4); kickoff guards and `current_location` (Task 5); route-editing RPCs and client types (Task 6); the route grid inside the station setup page, with validation (Task 7); print by location, locations-list trim, dashboard, player card, docs, verification (Task 8).

**Deliberately not built:** auto-suggesting a rotation (routes are hand-authored by choice), teams revisiting a location, unequal route lengths.
