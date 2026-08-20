# Elimination Rounds, Scratch Cards & Arcade Skin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-team-route hunt with a musical-chairs elimination race played on a grid of scratch cards, reskinned as an 8-bit arcade game, with a single-page admin monitor and a team-count generator.

**Architecture:** All game rules stay in Postgres `security definer` RPCs — the anon client only calls `team_view`, `submit_code`, `open_card`. One internal helper `team_view_json(team_id)` builds the player's read model so login, submit and card-open all return the identical shape, which keeps the React state a single object. Slot math is duplicated as pure TypeScript in `src/lib/rounds.ts` only for admin display and unit-testability; the server is authoritative. The client swaps 30s polling for Supabase realtime on `teams`/`game`/`card_opens`.

**Tech Stack:** Postgres 15 (Supabase), plpgsql, React 18 + TypeScript, Vite, React Router 6, Vitest + Testing Library (unit) and Vitest + supabase-js against a local Supabase stack (integration), plain CSS (no framework).

**Spec:** `docs/superpowers/specs/2026-08-20-elimination-scratch-cards-design.md`

## Global Constraints

- Slots: `slots(1) = alive`, `slots(L>1) = max(alive - 1, 1)`. `alive` = teams **not** eliminated (`status <> 'eliminated'`, so winners and finishers still count), including the submitting team, at the moment of the clear. Counting only `playing` teams would shrink the pool as teams finish and wrongly eliminate a team during the opening race of a one-level game.
- Elimination sweep fires when the clear fills the last slot: every `playing` team with `current_position < L` becomes `eliminated` with `out_at_level = L`.
- Last-standing: if exactly one `playing` team remains, `game.initial_team_count > 1`, **and no team has finished yet**, it becomes `winner` immediately. The finished-team guard matters when there are fewer levels than teams: there, teams leave `playing` by finishing rather than by being knocked out, and the stragglers still deserve their shot at the treasure.
- Codes match `^[A-Z0-9]{3,12}$` — no spaces, no punctuation. `normalize_code` strips everything outside `[A-Za-z0-9]` then upper-cases.
- Clue text for a locked level must never appear in any client payload.
- Team status is exactly one of `playing` | `eliminated` | `winner` | `finished`.
- `stations.sort_order` is the level: unique, `>= 1`, contiguous `1…M` enforced at `start_game`.
- Every admin RPC calls `assert_admin()` first, and is `revoke`d from `public, anon` then granted to `authenticated, service_role`.
- Any `UPDATE`/`DELETE` inside an RPC needs an explicit `where` clause (even `where true`) — Supabase API sessions load `safeupdate`, which rejects WHERE-less statements with SQLSTATE 21000.
- Migrations are append-only files under `supabase/migrations/`, named `20260820000001_*.sql` … `20260820000006_*.sql`. Never edit a shipped migration.
- Player-facing copy is arcade-flavoured but never mocking: elimination reads "GAME OVER" + "the other teams found all the codes".
- Fonts: `Press Start 2P` for chrome, `Figtree` for body copy. Both from Google Fonts, both with system fallbacks.
- Run unit tests with `npx vitest run src`; integration with `npx vitest run tests/integration --no-file-parallelism` (parallel files collide on the shared Supabase project).

---

## File Structure

**Created**
- `supabase/migrations/20260820000001_elimination_schema.sql` — tables/columns/constraints
- `supabase/migrations/20260820000002_codes.sql` — `normalize_code`, `random_team_code`
- `supabase/migrations/20260820000003_team_view.sql` — `team_view_json`, `team_view`
- `supabase/migrations/20260820000004_submit_code.sql` — slots, sweep, last-standing
- `supabase/migrations/20260820000005_cards_teams.sql` — `open_card`, `generate_teams`
- `supabase/migrations/20260820000006_admin.sql` — lifecycle guards, `admin_monitor`, RLS, drops
- `src/lib/rounds.ts` — pure slot/lock/placement helpers
- `src/lib/rounds.test.ts`
- `src/player/CardGrid.tsx` — the card grid screen
- `src/player/ScratchCard.tsx` — canvas foil card
- `src/player/RaceStatus.tsx` — live slot HUD
- `src/player/EliminatedScreen.tsx`
- `src/player/sprites.tsx` — pixel sprites (chest, lock, coin, ghost, flag)
- `src/admin/Dashboard.tsx` — the single monitor page
- `src/admin/useMonitor.ts` — realtime monitor rows
- `src/admin/Dashboard.test.tsx`

**Modified**
- `src/lib/api.ts` — new payload types, `teamView`/`submitCode`/`openCard`/`subscribeToGame`
- `src/lib/codes.ts` — dashless codes
- `src/player/usePlayerGame.ts` — single view object + realtime
- `src/player/PlayerApp.tsx` — route to new screens
- `src/player/FinishedScreen.tsx` — placing when several finish
- `src/player/LoginScreen.tsx` — placeholder copy
- `src/admin/AdminApp.tsx` — Dashboard replaces LiveBoard
- `src/admin/adminApi.ts` — `fetchMonitor`, `generateTeams`; route/final helpers removed
- `src/admin/TeamsPanel.tsx` — team-count generator
- `src/admin/StationsPanel.tsx` — Level column + code validation
- `src/admin/GameControl.tsx` — new error copy, route generation removed
- `src/admin/PrintPage.tsx` — level numbers
- `src/index.css` — arcade skin
- `index.html` — fonts
- `tests/integration/helpers.ts` — new seed/reset shape
- `README.md` — rules + runbook

**Deleted** (replaced, with their tests)
- `src/admin/LiveBoard.tsx`, `src/admin/LiveBoard.test.tsx`
- `src/admin/useAdminBoard.ts`
- `src/admin/sortBoard.ts`, `src/admin/sortBoard.test.ts`
- `src/player/GameScreen.tsx`
- `src/player/ChestIcon.tsx` (superseded by `sprites.tsx`)
- `tests/integration/routes-admin.test.ts`, `tests/integration/admin-board.test.ts`

---

## Task 1: Pure round math

**Files:**
- Create: `src/lib/rounds.ts`
- Test: `src/lib/rounds.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `slotsForLevel(level: number, alive: number): number`, `isUnlocked(level: number, cleared: number): boolean`, `setupWarning(levels: number, teams: number): string | null`, `comparePlacement(a: Placed, b: Placed): number` where `type Placed = { status: 'playing' | 'eliminated' | 'winner' | 'finished'; cleared_level: number; out_at_level: number | null; finished_at: string | null; eliminated_at: string | null }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/rounds.test.ts
import { slotsForLevel, isUnlocked, setupWarning, comparePlacement, type Placed } from './rounds'

describe('slotsForLevel', () => {
  it('fits every team in the opening race', () => {
    expect(slotsForLevel(1, 5)).toBe(5)
  })

  it('drops one team per later race', () => {
    expect(slotsForLevel(2, 5)).toBe(4)
    expect(slotsForLevel(3, 4)).toBe(3)
    expect(slotsForLevel(5, 2)).toBe(1)
  })

  it('never returns zero slots, so a solo game stays playable', () => {
    expect(slotsForLevel(4, 1)).toBe(1)
  })
})

describe('isUnlocked', () => {
  it('unlocks the first card and one past what is cleared', () => {
    expect(isUnlocked(1, 0)).toBe(true)
    expect(isUnlocked(2, 0)).toBe(false)
    expect(isUnlocked(3, 2)).toBe(true)
    expect(isUnlocked(4, 2)).toBe(false)
  })
})

describe('setupWarning', () => {
  it('is silent when levels match teams', () => {
    expect(setupWarning(5, 5)).toBeNull()
  })

  it('warns when there are too few levels to reach one winner', () => {
    expect(setupWarning(3, 5)).toMatch(/3 teams will claim the treasure together/i)
  })

  it('warns when spare levels will go unused', () => {
    expect(setupWarning(6, 3)).toMatch(/end at clue 3/i)
  })
})

describe('comparePlacement', () => {
  const base: Placed = {
    status: 'eliminated', cleared_level: 1, out_at_level: 2,
    finished_at: null, eliminated_at: '2026-08-20T10:00:00Z',
  }

  it('ranks finishers ahead of eliminated teams, earliest finish first', () => {
    const winner = { ...base, status: 'winner' as const, finished_at: '2026-08-20T10:05:00Z' }
    const second = { ...base, status: 'finished' as const, finished_at: '2026-08-20T10:06:00Z' }
    expect([base, second, winner].sort(comparePlacement).map(t => t.status))
      .toEqual(['winner', 'finished', 'eliminated'])
  })

  it('ranks a deeper elimination ahead of a shallower one', () => {
    const deep = { ...base, out_at_level: 4 }
    expect(comparePlacement(base, deep)).toBeGreaterThan(0)
  })

  it('ranks a later elimination ahead at the same level', () => {
    const later = { ...base, eliminated_at: '2026-08-20T10:09:00Z' }
    expect(comparePlacement(base, later)).toBeGreaterThan(0)
  })

  it('ranks teams still playing ahead of everyone out', () => {
    const playing = { ...base, status: 'playing' as const, cleared_level: 2, out_at_level: null }
    expect(comparePlacement(playing, base)).toBeLessThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/rounds.test.ts`
Expected: FAIL — `Failed to resolve import "./rounds"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/rounds.ts
export type TeamStatus = 'playing' | 'eliminated' | 'winner' | 'finished'

export type Placed = {
  status: TeamStatus
  cleared_level: number
  out_at_level: number | null
  finished_at: string | null
  eliminated_at: string | null
}

/**
 * The opening race fits everyone; every later race drops the slowest team.
 * `alive` counts teams that have not been eliminated — winners and finishers
 * still hold the slot they took.
 */
export function slotsForLevel(level: number, alive: number): number {
  if (level <= 1) return alive
  return Math.max(alive - 1, 1)
}

export function isUnlocked(level: number, cleared: number): boolean {
  return level <= cleared + 1
}

/**
 * Levels and teams need not match, but mismatches change how the game ends.
 * Returns null when the setup produces the intended single winner.
 */
export function setupWarning(levels: number, teams: number): string | null {
  if (levels === 0 || teams === 0) return null
  if (levels === teams) return null
  if (levels < teams) {
    const finishers = teams - levels + 1
    return `Only ${levels} clues for ${teams} teams — ${finishers} teams will claim the treasure together, placed by finish time.`
  }
  if (levels > teams) {
    return `${levels} clues for ${teams} teams — the hunt will end at clue ${teams} with one team standing, so the later clues go unused.`
  }
  return null
}

const rank: Record<TeamStatus, number> = { playing: 0, winner: 1, finished: 1, eliminated: 2 }

/** Sort comparator: best-placed team first. */
export function comparePlacement(a: Placed, b: Placed): number {
  if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status]
  if (a.status === 'playing') return b.cleared_level - a.cleared_level
  if (a.finished_at && b.finished_at) return a.finished_at.localeCompare(b.finished_at)
  const levelGap = (b.out_at_level ?? 0) - (a.out_at_level ?? 0)
  if (levelGap !== 0) return levelGap
  return (b.eliminated_at ?? '').localeCompare(a.eliminated_at ?? '')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/rounds.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rounds.ts src/lib/rounds.test.ts
git commit -m "feat: pure slot, lock and placement math for elimination rounds"
```

---

## Task 2: Schema migration

**Files:**
- Create: `supabase/migrations/20260820000001_elimination_schema.sql`
- Modify: `tests/integration/helpers.ts`
- Test: `tests/integration/schema.test.ts` (rewrite)

**Interfaces:**
- Consumes: nothing.
- Produces: `teams.status`/`eliminated_at`/`out_at_level`, `game.initial_team_count`, `card_opens(team_id, level, opened_at)`, `attempts.result` accepting `'too_late'`, `stations.sort_order` unique. Helper exports `resetDb(service)`, `seedStations(service, levels): SeededStation[]` (no `is_final` field), `createTeam`, `setGameStatus`, `clearCooldown`. `setRoute` is removed.

- [ ] **Step 1: Write the failing test**

Replace the body of `tests/integration/schema.test.ts` with:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb, seedStations, createTeam, serviceClient } from './helpers'

const service = serviceClient()

beforeEach(async () => {
  await resetDb(service)
})

describe('elimination schema', () => {
  it('defaults a new team to playing with nothing cleared', async () => {
    const team = await createTeam(service, 'Team 1', 'ALPHA1')
    expect(team.status).toBe('playing')
    expect(team.current_position).toBe(0)
    expect(team.out_at_level).toBeNull()
  })

  it('rejects an unknown team status', async () => {
    const { error } = await service.from('teams').insert({ name: 'Bad', team_code: 'BAD1', status: 'zombie' })
    expect(error?.message).toMatch(/status/i)
  })

  it('accepts too_late as an attempt result', async () => {
    const team = await createTeam(service, 'Team 1', 'ALPHA1')
    const { error } = await service
      .from('attempts')
      .insert({ team_id: team.id, submitted_code: 'NOPE', result: 'too_late' })
    expect(error).toBeNull()
  })

  it('keeps one card_opens row per team and level', async () => {
    const team = await createTeam(service, 'Team 1', 'ALPHA1')
    await service.from('card_opens').insert({ team_id: team.id, level: 1 })
    const { error } = await service.from('card_opens').insert({ team_id: team.id, level: 1 })
    expect(error?.message).toMatch(/duplicate key/i)
  })

  it('refuses two stations on the same level', async () => {
    await seedStations(service, 2)
    const { error } = await service
      .from('stations')
      .insert({ name: 'Clash', clue_text: 'x', code: 'CLASH1', sort_order: 1 })
    expect(error?.message).toMatch(/duplicate key|unique/i)
  })

  it('refuses a code with punctuation or spaces', async () => {
    const { error } = await service
      .from('stations')
      .insert({ name: 'Bad code', clue_text: 'x', code: 'NOT OK!', sort_order: 9 })
    expect(error?.message).toMatch(/code/i)
  })

  it('has dropped route_stops', async () => {
    const { error } = await service.from('route_stops').select('*').limit(1)
    expect(error).not.toBeNull()
  })
})
```

- [ ] **Step 2: Update the integration helpers**

In `tests/integration/helpers.ts`: delete `setRoute`, drop `route_stops` from `resetDb` and add `card_opens`, reset the new team columns, and reshape `seedStations`.

```ts
export async function resetDb(service: SupabaseClient = serviceClient()): Promise<void> {
  must(await service.from('attempts').delete().gte('id', 0))
  must(await service.from('card_opens').delete().gte('level', 0))
  must(await service.from('teams').delete().gte('created_at', '1970-01-01'))
  must(await service.from('stations').delete().gte('created_at', '1970-01-01'))
  must(
    await service
      .from('game')
      .update({ status: 'setup', started_at: null, ended_at: null, initial_team_count: null })
      .eq('id', 1),
  )
}

export type SeededStation = { id: string; name: string; clue_text: string; code: string; sort_order: number }

/** Creates `levels` stations on levels 1..levels with codes CODE1..CODEn. */
export async function seedStations(service: SupabaseClient, levels: number): Promise<SeededStation[]> {
  const rows = Array.from({ length: levels }, (_, i) => ({
    name: `Station ${i + 1}`,
    clue_text: `Clue leading to station ${i + 1}`,
    code: `CODE${i + 1}`,
    sort_order: i + 1,
  }))
  const { data, error } = await service.from('stations').insert(rows).select()
  if (error) throw new Error(error.message)
  return (data as SeededStation[]).sort((a, b) => a.sort_order - b.sort_order)
}

export async function createTeam(service: SupabaseClient, name: string, code: string) {
  const { data, error } = await service.from('teams').insert({ name, team_code: code }).select().single()
  if (error) throw new Error(error.message)
  return data as {
    id: string
    name: string
    team_code: string
    current_position: number
    status: string
    out_at_level: number | null
  }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/integration/schema.test.ts`
Expected: FAIL — `card_opens` does not exist / `status` column missing.

- [ ] **Step 4: Write the migration**

```sql
-- supabase/migrations/20260820000001_elimination_schema.sql

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
```

- [ ] **Step 5: Apply and verify**

Run: `npx supabase db reset` then `npx vitest run tests/integration/schema.test.ts`
Expected: PASS, 7 tests. Other integration files will fail until Tasks 3–7 land; that's expected.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260820000001_elimination_schema.sql tests/integration/helpers.ts tests/integration/schema.test.ts
git commit -m "feat: elimination schema — team status, card_opens, station levels"
```

---

## Task 3: Dashless codes

**Files:**
- Create: `supabase/migrations/20260820000002_codes.sql`
- Modify: `src/lib/codes.ts`, `src/lib/codes.test.ts`, `src/player/LoginScreen.tsx`
- Test: `tests/integration/codes.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: SQL `normalize_code(text) -> text` (strips non-alphanumerics, upper-cases) and `random_team_code() -> text` (6 chars, unambiguous alphabet). TS `generateCode(): string` returning e.g. `MANGO77`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/codes.test.ts — replace the file
import { generateCode } from './codes'

describe('generateCode', () => {
  it('produces only uppercase letters and digits', () => {
    for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^[A-Z0-9]{3,12}$/)
  })

  it('varies between calls', () => {
    const codes = new Set(Array.from({ length: 50 }, generateCode))
    expect(codes.size).toBeGreaterThan(1)
  })
})
```

```ts
// tests/integration/codes.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb, serviceClient } from './helpers'

const service = serviceClient()

beforeEach(async () => {
  await resetDb(service)
})

describe('normalize_code', () => {
  it('strips spaces, punctuation and case', async () => {
    const { data, error } = await service.rpc('normalize_code', { p: ' man go-77! ' })
    expect(error).toBeNull()
    expect(data).toBe('MANGO77')
  })
})

describe('random_team_code', () => {
  it('returns six unambiguous alphanumerics', async () => {
    const { data, error } = await service.rpc('random_team_code')
    expect(error).toBeNull()
    expect(data as string).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/codes.test.ts tests/integration/codes.test.ts`
Expected: unit FAIL on the dash in `MANGO-77`; integration FAIL — `random_team_code` does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260820000002_codes.sql

-- Codes are read off paper and typed on phones: fold away case, spaces and punctuation.
create or replace function public.normalize_code(p text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

-- Excludes I, O, 0, 1 so a handwritten slip can't be misread.
create or replace function public.random_team_code()
returns text
language sql
volatile
as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), ''
  )
  from generate_series(1, 6)
$$;

grant execute on function public.normalize_code(text) to anon, authenticated, service_role;
grant execute on function public.random_team_code() to authenticated, service_role;
```

- [ ] **Step 4: Write the TypeScript implementation**

```ts
// src/lib/codes.ts
const WORDS = [
  'TIGER', 'EAGLE', 'RIVER', 'MAPLE', 'COMET', 'NINJA', 'ROBOT', 'PIXEL',
  'MANGO', 'ZEBRA', 'FALCON', 'CACTUS', 'ROCKET', 'PANDA', 'STORM', 'EMBER',
  'ORBIT', 'QUARTZ', 'SPARK', 'LEMUR',
]

/** Codes get typed on phones and read off paper: letters and digits only. */
export function generateCode(): string {
  const word = WORDS[Math.floor(Math.random() * WORDS.length)]
  const num = Math.floor(Math.random() * 90) + 10
  return `${word}${num}`
}
```

In `src/player/LoginScreen.tsx` change the placeholder to `e.g. MANGO77`, and the same for the legend/label pair if it repeats the example.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx supabase db reset && npx vitest run src/lib/codes.test.ts tests/integration/codes.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260820000002_codes.sql src/lib/codes.ts src/lib/codes.test.ts tests/integration/codes.test.ts src/player/LoginScreen.tsx
git commit -m "feat: alphanumeric-only codes, server and client"
```

---

## Task 4: `team_view` read model

**Files:**
- Create: `supabase/migrations/20260820000003_team_view.sql`
- Test: `tests/integration/team-view.test.ts` (replaces `team-login.test.ts` — delete that file)

**Interfaces:**
- Consumes: schema from Task 2, `normalize_code` from Task 3.
- Produces: `team_view_json(p_team_id uuid) -> jsonb` (internal, reused by Tasks 5–6) and `team_view(p_team_code text) -> jsonb` granted to anon. Payload keys: `ok, team_name, game_status, status, cleared, total, out_at_level, place, race{level,slots,taken}, cards[{level,unlocked,opened,clue}]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/team-view.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { anonClient, createTeam, resetDb, seedStations, serviceClient, setGameStatus } from './helpers'

const service = serviceClient()
const anon = anonClient()

type Card = { level: number; unlocked: boolean; opened: boolean; clue: string | null }
type View = {
  ok: boolean
  team_name: string
  status: string
  cleared: number
  total: number
  place: number | null
  out_at_level: number | null
  race: { level: number; slots: number; taken: number } | null
  cards: Card[]
}

async function view(code: string): Promise<View> {
  const { data, error } = await anon.rpc('team_view', { p_team_code: code })
  if (error) throw new Error(error.message)
  return data as View
}

beforeEach(async () => {
  await resetDb(service)
})

describe('team_view', () => {
  it('rejects an unknown team code', async () => {
    const result = await view('NOPE99')
    expect(result).toMatchObject({ ok: false, error: 'invalid_team_code' })
  })

  it('normalizes the submitted team code', async () => {
    await seedStations(service, 3)
    await createTeam(service, 'Team 1', 'ALPHA1')
    expect((await view(' alpha-1 ')).team_name).toBe('Team 1')
  })

  it('returns one card per level with only the first unlocked once live', async () => {
    await seedStations(service, 4)
    await createTeam(service, 'Team 1', 'ALPHA1')
    await setGameStatus(service, 'live')

    const result = await view('ALPHA1')
    expect(result.total).toBe(4)
    expect(result.cards.map(c => c.level)).toEqual([1, 2, 3, 4])
    expect(result.cards.map(c => c.unlocked)).toEqual([true, false, false, false])
  })

  it('hides clue text for locked levels', async () => {
    await seedStations(service, 3)
    await createTeam(service, 'Team 1', 'ALPHA1')
    await setGameStatus(service, 'live')

    const result = await view('ALPHA1')
    expect(result.cards[0].clue).toBe('Clue leading to station 1')
    expect(result.cards[1].clue).toBeNull()
    expect(JSON.stringify(result)).not.toContain('station 2')
  })

  it('locks every card before the game goes live', async () => {
    await seedStations(service, 3)
    await createTeam(service, 'Team 1', 'ALPHA1')
    expect((await view('ALPHA1')).cards.every(c => !c.unlocked)).toBe(true)
  })

  it('reports the race with slots for the opening level', async () => {
    await seedStations(service, 3)
    await createTeam(service, 'Team 1', 'ALPHA1')
    await createTeam(service, 'Team 2', 'BETA22')
    await createTeam(service, 'Team 3', 'GAMMA3')
    await setGameStatus(service, 'live')

    expect((await view('ALPHA1')).race).toEqual({ level: 1, slots: 3, taken: 0 })
  })

  it('drops a slot for later races and counts teams already through', async () => {
    await seedStations(service, 3)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    await createTeam(service, 'Team 2', 'BETA22')
    await createTeam(service, 'Team 3', 'GAMMA3')
    await setGameStatus(service, 'live')
    await service.from('teams').update({ current_position: 1 }).eq('id', a.id)

    expect((await view('ALPHA1')).race).toEqual({ level: 2, slots: 2, taken: 1 })
  })

  it('marks opened cards and reports no race once eliminated', async () => {
    await seedStations(service, 3)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    await setGameStatus(service, 'live')
    await service.from('card_opens').insert({ team_id: a.id, level: 1 })
    await service.from('teams').update({ status: 'eliminated', out_at_level: 2, eliminated_at: new Date().toISOString() }).eq('id', a.id)

    const result = await view('ALPHA1')
    expect(result.cards[0].opened).toBe(true)
    expect(result.race).toBeNull()
    expect(result.status).toBe('eliminated')
    expect(result.out_at_level).toBe(2)
    expect(result.place).toBe(1)
  })
})
```

Delete `tests/integration/team-login.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/team-view.test.ts`
Expected: FAIL — `Could not find the function public.team_view`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260820000003_team_view.sql

-- One read model, reused by team_view, submit_code and open_card so the client
-- always re-renders from an identical payload shape.
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

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'level', s.sort_order,
        'unlocked', u.unlocked,
        'opened', co.team_id is not null,
        'clue', case when u.unlocked then s.clue_text else null end
      )
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

create or replace function public.team_view(p_team_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from teams where team_code = normalize_code(p_team_code);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_team_code');
  end if;
  return team_view_json(v_id);
end;
$$;

drop function if exists public.team_login(text);

revoke execute on function public.team_view_json(uuid) from public, anon;
grant execute on function public.team_view(text) to anon, authenticated, service_role;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase db reset && npx vitest run tests/integration/team-view.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260820000003_team_view.sql tests/integration/team-view.test.ts
git rm tests/integration/team-login.test.ts
git commit -m "feat: team_view read model with per-level cards and live race slots"
```

---

## Task 5: `submit_code` with slots, sweep and last-standing

**Files:**
- Create: `supabase/migrations/20260820000004_submit_code.sql`
- Test: `tests/integration/submit-code.test.ts` (rewrite)

**Interfaces:**
- Consumes: `team_view_json` (Task 4), `normalize_code` (Task 3).
- Produces: `submit_code(p_team_code text, p_code text) -> jsonb` returning `{ok:false,error:...}` or `{ok:true, correct:boolean, reason?:'wrong'|'already_used'|'too_late', view:<team_view payload>}`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/submit-code.test.ts — replace the file
import { beforeEach, describe, expect, it } from 'vitest'
import {
  anonClient, clearCooldown, createTeam, resetDb, seedStations, serviceClient, setGameStatus,
} from './helpers'

const service = serviceClient()
const anon = anonClient()

type Submit = {
  ok: boolean
  error?: string
  correct?: boolean
  reason?: string
  retry_after_seconds?: number
  view?: {
    cleared: number
    status: string
    race: { level: number; slots: number; taken: number } | null
    cards: { level: number; unlocked: boolean; opened: boolean; clue: string | null }[]
  }
}

async function submit(teamCode: string, code: string): Promise<Submit> {
  const { data, error } = await anon.rpc('submit_code', { p_team_code: teamCode, p_code: code })
  if (error) throw new Error(error.message)
  return data as Submit
}

async function teamRow(id: string) {
  const { data } = await service.from('teams').select('*').eq('id', id).single()
  return data as { current_position: number; status: string; out_at_level: number | null }
}

/** Three teams, three levels, game live, initial_team_count snapshotted. */
async function threeTeamGame() {
  const stations = await seedStations(service, 3)
  const a = await createTeam(service, 'Team 1', 'ALPHA1')
  const b = await createTeam(service, 'Team 2', 'BETA22')
  const c = await createTeam(service, 'Team 3', 'GAMMA3')
  await setGameStatus(service, 'live')
  await service.from('game').update({ initial_team_count: 3 }).eq('id', 1)
  return { stations, a, b, c }
}

beforeEach(async () => {
  await resetDb(service)
})

describe('submit_code', () => {
  it('accepts the level 1 code and unlocks the next card', async () => {
    const { a } = await threeTeamGame()
    const result = await submit('ALPHA1', 'code1')
    expect(result).toMatchObject({ ok: true, correct: true })
    expect(result.view!.cleared).toBe(1)
    expect(result.view!.cards.map(c => c.unlocked)).toEqual([true, true, false])
    expect((await teamRow(a.id)).current_position).toBe(1)
  })

  it('rejects a wrong code without advancing', async () => {
    const { a } = await threeTeamGame()
    const result = await submit('ALPHA1', 'WRONG9')
    expect(result).toMatchObject({ ok: true, correct: false, reason: 'wrong' })
    expect((await teamRow(a.id)).current_position).toBe(0)
  })

  it('nudges a team that re-enters a code it already used', async () => {
    const { a } = await threeTeamGame()
    await submit('ALPHA1', 'CODE1')
    await clearCooldown(service, a.id)
    expect(await submit('ALPHA1', 'CODE1')).toMatchObject({ correct: false, reason: 'already_used' })
  })

  it('lets every team through the opening race', async () => {
    await threeTeamGame()
    for (const code of ['ALPHA1', 'BETA22', 'GAMMA3']) {
      expect(await submit(code, 'CODE1')).toMatchObject({ correct: true })
    }
    const { data } = await service.from('teams').select('status')
    expect((data as { status: string }[]).every(t => t.status === 'playing')).toBe(true)
  })

  it('eliminates the slowest team when a later race fills', async () => {
    const { a, b, c } = await threeTeamGame()
    for (const code of ['ALPHA1', 'BETA22', 'GAMMA3']) await submit(code, 'CODE1')
    for (const id of [a.id, b.id, c.id]) await clearCooldown(service, id)

    // Level 2 has 3 alive - 1 = 2 slots
    await submit('ALPHA1', 'CODE2')
    expect((await teamRow(c.id)).status).toBe('playing')
    await submit('BETA22', 'CODE2')

    expect((await teamRow(c.id))).toMatchObject({ status: 'eliminated', out_at_level: 2 })
  })

  it('refuses a submit from an eliminated team', async () => {
    const { a, b, c } = await threeTeamGame()
    for (const code of ['ALPHA1', 'BETA22', 'GAMMA3']) await submit(code, 'CODE1')
    for (const id of [a.id, b.id, c.id]) await clearCooldown(service, id)
    await submit('ALPHA1', 'CODE2')
    await submit('BETA22', 'CODE2')

    expect(await submit('GAMMA3', 'CODE2')).toMatchObject({ ok: false, error: 'not_playing' })
  })

  it('crowns the last team standing without needing the final card', async () => {
    const { a, b, c } = await threeTeamGame()
    for (const code of ['ALPHA1', 'BETA22', 'GAMMA3']) await submit(code, 'CODE1')
    for (const id of [a.id, b.id, c.id]) await clearCooldown(service, id)
    await submit('ALPHA1', 'CODE2')
    await submit('BETA22', 'CODE2')  // C out
    for (const id of [a.id, b.id]) await clearCooldown(service, id)

    // Level 3 with 2 alive has 1 slot: A wins, B is swept
    await submit('ALPHA1', 'CODE3')
    expect((await teamRow(a.id)).status).toBe('winner')
    expect((await teamRow(b.id))).toMatchObject({ status: 'eliminated', out_at_level: 3 })
  })

  it('lets a solo team play the whole ladder', async () => {
    await seedStations(service, 3)
    const solo = await createTeam(service, 'Solo', 'SOLO12')
    await setGameStatus(service, 'live')
    await service.from('game').update({ initial_team_count: 1 }).eq('id', 1)

    for (const code of ['CODE1', 'CODE2', 'CODE3']) {
      expect(await submit('SOLO12', code)).toMatchObject({ correct: true })
      await clearCooldown(service, solo.id)
    }
    expect((await teamRow(solo.id))).toMatchObject({ status: 'winner', current_position: 3 })
  })

  it('places later finishers behind the winner when clues run short', async () => {
    const stations = await seedStations(service, 1)
    expect(stations).toHaveLength(1)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    const b = await createTeam(service, 'Team 2', 'BETA22')
    const c = await createTeam(service, 'Team 3', 'GAMMA3')
    await setGameStatus(service, 'live')
    await service.from('game').update({ initial_team_count: 3 }).eq('id', 1)

    // One level, 3 alive: the opening race fits everyone, so all three finish.
    // Regression guard: counting only 'playing' teams as alive would shrink the
    // pool as each team finishes and eliminate the last one instead.
    await submit('ALPHA1', 'CODE1')
    await submit('BETA22', 'CODE1')
    await submit('GAMMA3', 'CODE1')

    expect((await teamRow(a.id)).status).toBe('winner')
    expect((await teamRow(b.id)).status).toBe('finished')
    expect((await teamRow(c.id)).status).toBe('finished')
  })

  it('rejects submits while the game is paused', async () => {
    await threeTeamGame()
    await setGameStatus(service, 'paused')
    expect(await submit('ALPHA1', 'CODE1')).toMatchObject({ ok: false, error: 'game_not_live' })
  })

  it('enforces the five second cooldown', async () => {
    await threeTeamGame()
    await submit('ALPHA1', 'WRONG1')
    const second = await submit('ALPHA1', 'WRONG2')
    expect(second).toMatchObject({ ok: false, error: 'cooldown' })
    expect(second.retry_after_seconds as number).toBeGreaterThan(0)
  })

  it('serializes two teams racing for the last slot', async () => {
    const { a, b, c } = await threeTeamGame()
    for (const code of ['ALPHA1', 'BETA22', 'GAMMA3']) await submit(code, 'CODE1')
    for (const id of [a.id, b.id, c.id]) await clearCooldown(service, id)
    await submit('ALPHA1', 'CODE2')
    for (const id of [b.id, c.id]) await clearCooldown(service, id)

    // One slot left, two teams submit at once: exactly one gets it
    const [first, second] = await Promise.all([submit('BETA22', 'CODE2'), submit('GAMMA3', 'CODE2')])
    const outcomes = [first, second].map(r => (r.ok && r.correct ? 'through' : r.reason ?? r.error))
    expect(outcomes.filter(o => o === 'through')).toHaveLength(1)
    expect(outcomes.filter(o => o === 'too_late' || o === 'not_playing')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/submit-code.test.ts`
Expected: FAIL — old `submit_code` returns `position`/`clue` and knows nothing about `status`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260820000004_submit_code.sql

create or replace function public.submit_code(p_team_code text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams%rowtype;
  v_status text;
  v_initial int;
  v_code text := normalize_code(p_code);
  v_last timestamptz;
  v_wait int;
  v_total int;
  v_level int;
  v_alive int;
  v_slots int;
  v_taken int;
  v_expected text;
  v_first boolean;
begin
  -- Every submit queues on the single game row, so two teams racing for the
  -- last slot are resolved one at a time instead of both seeing it free.
  select status, initial_team_count into v_status, v_initial from game where id = 1 for update;

  select * into v_team from teams where team_code = normalize_code(p_team_code) for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_team_code');
  end if;
  if v_status <> 'live' then
    return jsonb_build_object('ok', false, 'error', 'game_not_live');
  end if;
  if v_team.status <> 'playing' then
    return jsonb_build_object('ok', false, 'error', 'not_playing');
  end if;

  select max(created_at) into v_last from attempts where team_id = v_team.id;
  if v_last is not null and v_last > now() - interval '5 seconds' then
    v_wait := ceil(extract(epoch from (v_last + interval '5 seconds') - now()))::int;
    return jsonb_build_object(
      'ok', false, 'error', 'cooldown', 'retry_after_seconds', greatest(v_wait, 1)
    );
  end if;

  select count(*)::int into v_total from stations;
  v_level := v_team.current_position + 1;

  if exists (select 1 from stations where code = v_code and sort_order <= v_team.current_position) then
    insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'already_used');
    return jsonb_build_object(
      'ok', true, 'correct', false, 'reason', 'already_used', 'view', team_view_json(v_team.id)
    );
  end if;

  select code into v_expected from stations where sort_order = v_level;
  if v_expected is distinct from v_code then
    insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'wrong');
    return jsonb_build_object(
      'ok', true, 'correct', false, 'reason', 'wrong', 'view', team_view_json(v_team.id)
    );
  end if;

  -- The opening race fits everyone; later races drop the slowest team.
  -- Winners and finishers still hold their slot, so only eliminated teams leave the pool.
  select count(*)::int into v_alive from teams where status <> 'eliminated';
  v_slots := case when v_level <= 1 then v_alive else greatest(v_alive - 1, 1) end;
  select count(*)::int into v_taken from teams where current_position >= v_level;

  if v_taken >= v_slots then
    insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'too_late');
    update teams
    set status = 'eliminated', eliminated_at = now(), out_at_level = v_level
    where id = v_team.id;
    return jsonb_build_object(
      'ok', true, 'correct', false, 'reason', 'too_late', 'view', team_view_json(v_team.id)
    );
  end if;

  insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'correct');

  if v_level >= v_total then
    select not exists (select 1 from teams where finished_at is not null) into v_first;
    update teams
    set current_position = v_level,
        finished_at = now(),
        status = case when v_first then 'winner' else 'finished' end
    where id = v_team.id;
  else
    update teams set current_position = v_level where id = v_team.id;
  end if;

  -- This clear took the last slot: everyone still below this level is out.
  if v_taken + 1 >= v_slots then
    update teams
    set status = 'eliminated', eliminated_at = now(), out_at_level = v_level
    where status = 'playing' and current_position < v_level;
  end if;

  -- Last team standing wins outright. Skipped for a solo practice game so a
  -- single team can walk the whole ladder, and skipped once anyone has finished
  -- (with fewer levels than teams, the others are finishers, not casualties).
  if coalesce(v_initial, 0) > 1
     and (select count(*) from teams where status = 'playing') = 1
     and not exists (select 1 from teams where finished_at is not null) then
    update teams
    set status = 'winner', finished_at = coalesce(finished_at, now())
    where status = 'playing';
  end if;

  return jsonb_build_object('ok', true, 'correct', true, 'view', team_view_json(v_team.id));
end;
$$;

grant execute on function public.submit_code(text, text) to anon, authenticated, service_role;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase db reset && npx vitest run tests/integration/submit-code.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260820000004_submit_code.sql tests/integration/submit-code.test.ts
git commit -m "feat: slot-limited submit_code with instant elimination sweep"
```

---

## Task 6: `open_card` and `generate_teams`

**Files:**
- Create: `supabase/migrations/20260820000005_cards_teams.sql`
- Test: `tests/integration/cards-teams.test.ts`

**Interfaces:**
- Consumes: `team_view_json` (Task 4), `random_team_code` (Task 3), `assert_admin` (existing).
- Produces: `open_card(p_team_code text, p_level int) -> jsonb` → `{ok:true, level, clue, view}` (anon-callable); `generate_teams(p_count int) -> jsonb` → `{ok:true, created, total}` (admin-only).

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/cards-teams.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import {
  adminClient, anonClient, createTeam, resetDb, seedStations, serviceClient, setGameStatus,
} from './helpers'

const service = serviceClient()
const anon = anonClient()

async function openCard(teamCode: string, level: number) {
  const { data, error } = await anon.rpc('open_card', { p_team_code: teamCode, p_level: level })
  if (error) throw new Error(error.message)
  return data as { ok: boolean; error?: string; clue?: string; view?: { cards: { opened: boolean }[] } }
}

beforeEach(async () => {
  await resetDb(service)
})

describe('open_card', () => {
  it('reveals an unlocked clue and records the open', async () => {
    await seedStations(service, 3)
    const team = await createTeam(service, 'Team 1', 'ALPHA1')
    await setGameStatus(service, 'live')

    const result = await openCard('ALPHA1', 1)
    expect(result.ok).toBe(true)
    expect(result.clue).toBe('Clue leading to station 1')
    expect(result.view!.cards[0].opened).toBe(true)

    const { data } = await service.from('card_opens').select('*').eq('team_id', team.id)
    expect(data).toHaveLength(1)
  })

  it('is a no-op on a repeat scratch', async () => {
    await seedStations(service, 3)
    const team = await createTeam(service, 'Team 1', 'ALPHA1')
    await setGameStatus(service, 'live')

    await openCard('ALPHA1', 1)
    expect((await openCard('ALPHA1', 1)).ok).toBe(true)
    const { data } = await service.from('card_opens').select('*').eq('team_id', team.id)
    expect(data).toHaveLength(1)
  })

  it('refuses a locked level and leaks no clue', async () => {
    await seedStations(service, 3)
    await createTeam(service, 'Team 1', 'ALPHA1')
    await setGameStatus(service, 'live')

    const result = await openCard('ALPHA1', 3)
    expect(result).toMatchObject({ ok: false, error: 'locked' })
    expect(JSON.stringify(result)).not.toContain('station 3')
  })

  it('refuses before the game is live', async () => {
    await seedStations(service, 3)
    await createTeam(service, 'Team 1', 'ALPHA1')
    expect(await openCard('ALPHA1', 1)).toMatchObject({ ok: false, error: 'game_not_live' })
  })

  it('lets an eliminated team re-open a card it already had', async () => {
    await seedStations(service, 3)
    const team = await createTeam(service, 'Team 1', 'ALPHA1')
    await setGameStatus(service, 'live')
    await service.from('teams')
      .update({ status: 'eliminated', out_at_level: 1, eliminated_at: new Date().toISOString() })
      .eq('id', team.id)

    expect((await openCard('ALPHA1', 1)).ok).toBe(true)
  })
})

describe('generate_teams', () => {
  it('creates teams up to the requested count with valid codes', async () => {
    const admin = await adminClient()
    const { data, error } = await admin.rpc('generate_teams', { p_count: 3 })
    expect(error).toBeNull()
    expect(data).toMatchObject({ ok: true, created: 3, total: 3 })

    const { data: teams } = await service.from('teams').select('name, team_code').order('name')
    expect((teams as { name: string }[]).map(t => t.name)).toEqual(['Team 1', 'Team 2', 'Team 3'])
    for (const t of teams as { team_code: string }[]) expect(t.team_code).toMatch(/^[A-Z0-9]{3,12}$/)
  })

  it('tops up rather than duplicating existing teams', async () => {
    const admin = await adminClient()
    await createTeam(service, 'Team 1', 'ALPHA1')
    const { data } = await admin.rpc('generate_teams', { p_count: 3 })
    expect(data).toMatchObject({ ok: true, created: 2, total: 3 })
  })

  it('creates nothing when the count is already met', async () => {
    const admin = await adminClient()
    await createTeam(service, 'Team 1', 'ALPHA1')
    await createTeam(service, 'Team 2', 'BETA22')
    expect(await admin.rpc('generate_teams', { p_count: 2 }).then(r => r.data))
      .toMatchObject({ ok: true, created: 0, total: 2 })
  })

  it('refuses while the game is live', async () => {
    const admin = await adminClient()
    await setGameStatus(service, 'live')
    expect(await admin.rpc('generate_teams', { p_count: 3 }).then(r => r.data))
      .toMatchObject({ ok: false, error: 'game_live' })
  })

  it('rejects a nonsense count', async () => {
    const admin = await adminClient()
    expect(await admin.rpc('generate_teams', { p_count: 0 }).then(r => r.data))
      .toMatchObject({ ok: false, error: 'bad_count' })
  })

  it('is not callable anonymously', async () => {
    const { error } = await anon.rpc('generate_teams', { p_count: 3 })
    expect(error).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/cards-teams.test.ts`
Expected: FAIL — `Could not find the function public.open_card`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260820000005_cards_teams.sql

-- Scratching a card always goes through the server, so a locked clue can never
-- be revealed by poking at the canvas.
create or replace function public.open_card(p_team_code text, p_level int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams%rowtype;
  v_status text;
  v_clue text;
begin
  select * into v_team from teams where team_code = normalize_code(p_team_code);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_team_code');
  end if;

  select status into v_status from game where id = 1;
  if v_status <> 'live' then
    return jsonb_build_object('ok', false, 'error', 'game_not_live');
  end if;

  if p_level is null or p_level < 1 or p_level > v_team.current_position + 1 then
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;

  select clue_text into v_clue from stations where sort_order = p_level;
  if v_clue is null then
    return jsonb_build_object('ok', false, 'error', 'no_such_level');
  end if;

  insert into card_opens (team_id, level) values (v_team.id, p_level)
  on conflict (team_id, level) do nothing;

  return jsonb_build_object(
    'ok', true, 'level', p_level, 'clue', v_clue, 'view', team_view_json(v_team.id)
  );
end;
$$;

-- Admin types a team count; names are Team 1..N and codes are collision-checked.
create or replace function public.generate_teams(p_count int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_existing int;
  v_created int := 0;
  v_code text;
  v_i int;
begin
  perform assert_admin();

  select status into v_status from game where id = 1;
  if v_status = 'live' then
    return jsonb_build_object('ok', false, 'error', 'game_live');
  end if;
  if p_count is null or p_count < 1 or p_count > 50 then
    return jsonb_build_object('ok', false, 'error', 'bad_count');
  end if;

  select count(*)::int into v_existing from teams;

  for v_i in (v_existing + 1)..p_count loop
    loop
      v_code := random_team_code();
      exit when not exists (select 1 from teams where team_code = v_code);
    end loop;
    insert into teams (name, team_code) values ('Team ' || v_i, v_code);
    v_created := v_created + 1;
  end loop;

  return jsonb_build_object(
    'ok', true, 'created', v_created, 'total', greatest(v_existing, p_count)
  );
end;
$$;

grant execute on function public.open_card(text, int) to anon, authenticated, service_role;
revoke execute on function public.generate_teams(int) from public, anon;
grant execute on function public.generate_teams(int) to authenticated, service_role;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase db reset && npx vitest run tests/integration/cards-teams.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260820000005_cards_teams.sql tests/integration/cards-teams.test.ts
git commit -m "feat: open_card scratch tracking and generate_teams by count"
```

---

## Task 7: Lifecycle guards and admin monitor view

**Files:**
- Create: `supabase/migrations/20260820000006_admin.sql`
- Test: `tests/integration/game-lifecycle.test.ts` (rewrite), `tests/integration/admin-monitor.test.ts` (new)
- Delete: `tests/integration/routes-admin.test.ts`, `tests/integration/admin-board.test.ts`

**Interfaces:**
- Consumes: schema from Task 2.
- Produces: `start_game()` returning `{ok:false,error:'no_stations'|'no_teams'|'level_gap'|'not_in_setup'}` or `{ok:true,status:'live',teams:int,levels:int}`; `reset_progress()` clearing cards and statuses; view `admin_monitor(id, name, team_code, status, cleared_level, out_at_level, finished_at, eliminated_at, created_at, started, max_opened_level, last_solve_at, wrong_count)`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/integration/admin-monitor.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { adminClient, anonClient, createTeam, resetDb, seedStations, serviceClient, setGameStatus } from './helpers'

const service = serviceClient()

beforeEach(async () => {
  await resetDb(service)
})

describe('admin_monitor', () => {
  it('reports start, progress, opens and wrong attempts per team', async () => {
    await seedStations(service, 3)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    await createTeam(service, 'Team 2', 'BETA22')
    await setGameStatus(service, 'live')
    await service.from('card_opens').insert([
      { team_id: a.id, level: 1 },
      { team_id: a.id, level: 2 },
    ])
    await service.from('teams').update({ current_position: 1 }).eq('id', a.id)
    await service.from('attempts').insert([
      { team_id: a.id, submitted_code: 'CODE1', result: 'correct' },
      { team_id: a.id, submitted_code: 'NOPE1', result: 'wrong' },
      { team_id: a.id, submitted_code: 'NOPE2', result: 'too_late' },
    ])

    const admin = await adminClient()
    const { data, error } = await admin.from('admin_monitor').select('*').order('name')
    expect(error).toBeNull()
    const rows = data as Record<string, unknown>[]
    expect(rows[0]).toMatchObject({
      name: 'Team 1', started: true, max_opened_level: 2, cleared_level: 1, wrong_count: 2,
    })
    expect(rows[0].last_solve_at).not.toBeNull()
    expect(rows[1]).toMatchObject({ name: 'Team 2', started: false, cleared_level: 0, wrong_count: 0 })
    expect(rows[1].max_opened_level).toBeNull()
  })

  it('is not readable anonymously', async () => {
    const { data, error } = await anonClient().from('admin_monitor').select('*')
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })
})
```

Rewrite `tests/integration/game-lifecycle.test.ts` start-up cases:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { adminClient, createTeam, resetDb, seedStations, serviceClient } from './helpers'

const service = serviceClient()

beforeEach(async () => {
  await resetDb(service)
})

describe('start_game', () => {
  it('refuses with no stations', async () => {
    const admin = await adminClient()
    await createTeam(service, 'Team 1', 'ALPHA1')
    expect(await admin.rpc('start_game').then(r => r.data)).toMatchObject({ ok: false, error: 'no_stations' })
  })

  it('refuses with no teams', async () => {
    const admin = await adminClient()
    await seedStations(service, 2)
    expect(await admin.rpc('start_game').then(r => r.data)).toMatchObject({ ok: false, error: 'no_teams' })
  })

  it('refuses when levels are not contiguous from 1', async () => {
    const admin = await adminClient()
    await createTeam(service, 'Team 1', 'ALPHA1')
    await service.from('stations').insert([
      { name: 'A', clue_text: 'a', code: 'AAA1', sort_order: 1 },
      { name: 'C', clue_text: 'c', code: 'CCC3', sort_order: 3 },
    ])
    expect(await admin.rpc('start_game').then(r => r.data)).toMatchObject({ ok: false, error: 'level_gap' })
  })

  it('starts with mismatched counts and snapshots the team count', async () => {
    const admin = await adminClient()
    await seedStations(service, 2)
    await createTeam(service, 'Team 1', 'ALPHA1')
    await createTeam(service, 'Team 2', 'BETA22')
    await createTeam(service, 'Team 3', 'GAMMA3')

    expect(await admin.rpc('start_game').then(r => r.data))
      .toMatchObject({ ok: true, status: 'live', teams: 3, levels: 2 })
    const { data } = await service.from('game').select('initial_team_count').single()
    expect((data as { initial_team_count: number }).initial_team_count).toBe(3)
  })
})

describe('reset_progress', () => {
  it('clears statuses, cards and the team-count snapshot', async () => {
    const admin = await adminClient()
    await seedStations(service, 2)
    const team = await createTeam(service, 'Team 1', 'ALPHA1')
    await admin.rpc('start_game')
    await service.from('card_opens').insert({ team_id: team.id, level: 1 })
    await service.from('teams')
      .update({ current_position: 2, status: 'winner', finished_at: new Date().toISOString() })
      .eq('id', team.id)

    expect(await admin.rpc('reset_progress').then(r => r.data)).toMatchObject({ ok: true, status: 'setup' })

    const { data: rows } = await service.from('teams').select('current_position, status, finished_at, out_at_level')
    expect(rows).toEqual([{ current_position: 0, status: 'playing', finished_at: null, out_at_level: null }])
    const { data: opens } = await service.from('card_opens').select('*')
    expect(opens).toEqual([])
    const { data: game } = await service.from('game').select('initial_team_count').single()
    expect((game as { initial_team_count: number | null }).initial_team_count).toBeNull()
  })
})
```

Keep the existing pause/resume/end cases in that file unchanged.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/integration/admin-monitor.test.ts tests/integration/game-lifecycle.test.ts`
Expected: FAIL — `admin_monitor` does not exist; `start_game` still demands a final station.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260820000006_admin.sql

create or replace function public.start_game()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_levels int;
  v_min int;
  v_max int;
  v_teams int;
begin
  perform assert_admin();
  select status into v_status from game where id = 1;
  if v_status <> 'setup' then
    return jsonb_build_object('ok', false, 'error', 'not_in_setup');
  end if;

  select count(*)::int, coalesce(min(sort_order), 0), coalesce(max(sort_order), 0)
  into v_levels, v_min, v_max
  from stations;
  if v_levels = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_stations');
  end if;
  -- Levels must be 1..M with no holes, or a team could hit an unreachable card.
  if v_min <> 1 or v_max <> v_levels then
    return jsonb_build_object('ok', false, 'error', 'level_gap');
  end if;

  select count(*)::int into v_teams from teams;
  if v_teams = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_teams');
  end if;

  update game
  set status = 'live', started_at = now(), ended_at = null, initial_team_count = v_teams
  where id = 1;

  return jsonb_build_object('ok', true, 'status', 'live', 'teams', v_teams, 'levels', v_levels);
end;
$$;

create or replace function public.reset_progress()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_admin();
  -- 'where true' is required: Supabase API sessions load safeupdate, which
  -- rejects WHERE-less UPDATE/DELETE (SQLSTATE 21000) even inside SECURITY DEFINER.
  update teams
  set current_position = 0, finished_at = null, status = 'playing',
      eliminated_at = null, out_at_level = null
  where true;
  delete from card_opens where true;
  delete from attempts where true;
  update game set status = 'setup', started_at = null, ended_at = null, initial_team_count = null
  where id = 1;
  return jsonb_build_object('ok', true, 'status', 'setup');
end;
$$;

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
  (select count(*)::int from attempts a where a.team_id = t.id and a.result in ('wrong', 'too_late')) as wrong_count
from teams t;

revoke all on public.admin_monitor from anon;
grant select on public.admin_monitor to authenticated;
```

- [ ] **Step 4: Delete the obsolete integration suites**

```bash
git rm tests/integration/routes-admin.test.ts tests/integration/admin-board.test.ts
```

- [ ] **Step 5: Run the whole integration suite**

Run: `npx supabase db reset && npx vitest run tests/integration --no-file-parallelism`
Expected: PASS — every file green (schema, codes, team-view, submit-code, cards-teams, admin-monitor, game-lifecycle, rls).

- [ ] **Step 6: Fix `rls.test.ts` if it references dropped objects**

`route_stops` and `admin_board` are gone; replace those cases with `card_opens` and `admin_monitor` denial checks in the same style as the existing ones.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260820000006_admin.sql tests/integration
git commit -m "feat: start_game level guards, reset clears cards, admin_monitor view"
```

---

## Task 8: Client API layer and player state

**Files:**
- Modify: `src/lib/api.ts`, `src/player/usePlayerGame.ts`
- Test: `src/lib/api.test.ts` (new)

**Interfaces:**
- Consumes: RPCs `team_view`, `submit_code`, `open_card` (Tasks 4–6).
- Produces:
  - `type TeamStatus = 'playing' | 'eliminated' | 'winner' | 'finished'`
  - `type Card = { level: number; unlocked: boolean; opened: boolean; clue: string | null }`
  - `type Race = { level: number; slots: number; taken: number }`
  - `type TeamView = { ok: true; team_name: string; game_status: GameStatus; status: TeamStatus; cleared: number; total: number; out_at_level: number | null; place: number | null; race: Race | null; cards: Card[] }`
  - `type ViewResult = { ok: false; error: 'invalid_team_code' } | TeamView`
  - `type SubmitResult = { ok: false; error: 'invalid_team_code' | 'game_not_live' | 'not_playing' } | { ok: false; error: 'cooldown'; retry_after_seconds: number } | { ok: true; correct: false; reason: 'wrong' | 'already_used' | 'too_late'; view: TeamView } | { ok: true; correct: true; view: TeamView }`
  - `type OpenResult = { ok: false; error: string } | { ok: true; level: number; clue: string; view: TeamView }`
  - `teamView(teamCode): Promise<ViewResult>`, `submitCode(teamCode, code): Promise<SubmitResult>`, `openCard(teamCode, level): Promise<OpenResult>`, `subscribeToGame(onChange: () => void): () => void`
  - `usePlayerGame()` returning `{ view, restoring, loginError, feedback, busy, login, submit, openCard }` where `feedback` is `{ kind: 'wrong' | 'already_used' | 'correct' | 'too_late' } | { kind: 'cooldown'; seconds: number } | { kind: 'error'; message: string } | null`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/api.test.ts
import { teamView, submitCode, openCard } from './api'
import { supabase } from './supabaseClient'

vi.mock('./supabaseClient', () => ({ supabase: { rpc: vi.fn() } }))
const rpc = vi.mocked(supabase.rpc)

beforeEach(() => vi.clearAllMocks())

describe('api', () => {
  it('calls team_view with the team code', async () => {
    rpc.mockResolvedValue({ data: { ok: true, cards: [] }, error: null } as never)
    await teamView('ALPHA1')
    expect(rpc).toHaveBeenCalledWith('team_view', { p_team_code: 'ALPHA1' })
  })

  it('calls submit_code with the team code and the entered code', async () => {
    rpc.mockResolvedValue({ data: { ok: true, correct: true }, error: null } as never)
    await submitCode('ALPHA1', 'code1')
    expect(rpc).toHaveBeenCalledWith('submit_code', { p_team_code: 'ALPHA1', p_code: 'code1' })
  })

  it('calls open_card with the level', async () => {
    rpc.mockResolvedValue({ data: { ok: true, level: 2 }, error: null } as never)
    await openCard('ALPHA1', 2)
    expect(rpc).toHaveBeenCalledWith('open_card', { p_team_code: 'ALPHA1', p_level: 2 })
  })

  it('throws on a transport error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } } as never)
    await expect(teamView('ALPHA1')).rejects.toMatchObject({ message: 'boom' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/api.test.ts`
Expected: FAIL — `teamView` is not exported.

- [ ] **Step 3: Rewrite `src/lib/api.ts`**

```ts
import { supabase } from './supabaseClient'

export type GameStatus = 'setup' | 'live' | 'paused' | 'ended'
export type TeamStatus = 'playing' | 'eliminated' | 'winner' | 'finished'

export type Card = { level: number; unlocked: boolean; opened: boolean; clue: string | null }
export type Race = { level: number; slots: number; taken: number }

export type TeamView = {
  ok: true
  team_name: string
  game_status: GameStatus
  status: TeamStatus
  cleared: number
  total: number
  out_at_level: number | null
  place: number | null
  race: Race | null
  cards: Card[]
}

export type ViewResult = { ok: false; error: 'invalid_team_code' } | TeamView

export type SubmitResult =
  | { ok: false; error: 'invalid_team_code' | 'game_not_live' | 'not_playing' }
  | { ok: false; error: 'cooldown'; retry_after_seconds: number }
  | { ok: true; correct: false; reason: 'wrong' | 'already_used' | 'too_late'; view: TeamView }
  | { ok: true; correct: true; view: TeamView }

export type OpenResult =
  | { ok: false; error: 'invalid_team_code' | 'game_not_live' | 'locked' | 'no_such_level' }
  | { ok: true; level: number; clue: string; view: TeamView }

export async function teamView(teamCode: string): Promise<ViewResult> {
  const { data, error } = await supabase.rpc('team_view', { p_team_code: teamCode })
  if (error) throw error
  return data as ViewResult
}

export async function submitCode(teamCode: string, code: string): Promise<SubmitResult> {
  const { data, error } = await supabase.rpc('submit_code', { p_team_code: teamCode, p_code: code })
  if (error) throw error
  return data as SubmitResult
}

export async function openCard(teamCode: string, level: number): Promise<OpenResult> {
  const { data, error } = await supabase.rpc('open_card', { p_team_code: teamCode, p_level: level })
  if (error) throw error
  return data as OpenResult
}

/**
 * Any change to teams, the game row or card opens can change what this team
 * sees (a rival taking the last slot eliminates them without them acting), so
 * every event just triggers a refetch of the whole view.
 */
export function subscribeToGame(onChange: () => void): () => void {
  const channel = supabase
    .channel('hunt-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'card_opens' }, onChange)
    .subscribe()
  return () => {
    void supabase.removeChannel(channel)
  }
}
```

- [ ] **Step 4: Rewrite `src/player/usePlayerGame.ts`**

Keep the localStorage session and the 30s poll as a realtime fallback; replace `teamLogin` with `teamView`, store the whole view from every mutation, and add `openCard`.

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { teamView, submitCode, openCard as openCardApi, subscribeToGame, type TeamView } from '../lib/api'

const STORAGE_KEY = 'treasure_team_code'
const POLL_MS = 30_000

export type Feedback =
  | { kind: 'wrong' | 'already_used' | 'correct' | 'too_late' }
  | { kind: 'cooldown'; seconds: number }
  | { kind: 'error'; message: string }

export function usePlayerGame() {
  const [teamCode, setTeamCode] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY))
  const [view, setView] = useState<TeamView | null>(null)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(() => localStorage.getItem(STORAGE_KEY) !== null)
  const codeRef = useRef(teamCode)
  codeRef.current = teamCode

  const forgetTeam = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setTeamCode(null)
    setView(null)
  }, [])

  const refresh = useCallback(async () => {
    const code = codeRef.current
    if (!code) return
    try {
      const result = await teamView(code)
      if (result.ok) setView(result)
      else forgetTeam()
    } catch {
      // Network hiccup: keep showing the last known view
    }
  }, [forgetTeam])

  const login = useCallback(async (code: string) => {
    setBusy(true)
    setLoginError(null)
    try {
      const result = await teamView(code)
      if (result.ok) {
        localStorage.setItem(STORAGE_KEY, code)
        setTeamCode(code)
        setView(result)
      } else {
        setLoginError("That team code doesn't match any team. Double-check it!")
      }
    } catch {
      setLoginError('Network problem — try again.')
    } finally {
      setBusy(false)
    }
  }, [])

  const submit = useCallback(async (code: string) => {
    const current = codeRef.current
    if (!current) return
    setBusy(true)
    setFeedback(null)
    try {
      const result = await submitCode(current, code)
      if (!result.ok) {
        if (result.error === 'cooldown') setFeedback({ kind: 'cooldown', seconds: result.retry_after_seconds })
        else if (result.error === 'invalid_team_code') forgetTeam()
        else await refresh()
        return
      }
      setView(result.view)
      setFeedback(result.correct ? { kind: 'correct' } : { kind: result.reason })
    } catch {
      setFeedback({ kind: 'error', message: 'Network problem — try again.' })
    } finally {
      setBusy(false)
    }
  }, [forgetTeam, refresh])

  const openCard = useCallback(async (level: number) => {
    const current = codeRef.current
    if (!current) return
    try {
      const result = await openCardApi(current, level)
      if (result.ok) setView(result.view)
      else await refresh()
    } catch {
      setFeedback({ kind: 'error', message: 'Network problem — try again.' })
    }
  }, [refresh])

  useEffect(() => {
    if (!restoring) return
    refresh().finally(() => setRestoring(false))
  }, [restoring, refresh])

  // A rival can eliminate this team without it doing anything, so stay subscribed.
  useEffect(() => {
    if (!teamCode) return
    const unsubscribe = subscribeToGame(() => { void refresh() })
    const interval = setInterval(refresh, POLL_MS)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      unsubscribe()
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [teamCode, refresh])

  return { view, restoring, loginError, feedback, busy, login, submit, openCard }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/api.test.ts && npx tsc --noEmit`
Expected: api tests PASS. `tsc` still fails inside `GameScreen.tsx` / `PlayerApp.tsx` / admin files — those are Tasks 9–14.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api.ts src/lib/api.test.ts src/player/usePlayerGame.ts
git commit -m "feat: card-based client API with realtime refresh"
```

---

## Task 9: ScratchCard component

**Files:**
- Create: `src/player/ScratchCard.tsx`, `src/player/ScratchCard.test.tsx`
- Create: `src/player/sprites.tsx`

**Interfaces:**
- Consumes: `Card` type from `src/lib/api.ts`.
- Produces: `<ScratchCard card={Card} isCurrent={boolean} onOpen={(level: number) => void} />`; sprites `<ChestSprite />`, `<LockSprite />`, `<CoinSprite />`, `<GhostSprite />`, `<FlagSprite />` each accepting `{ className?: string }`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/player/ScratchCard.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ScratchCard from './ScratchCard'
import type { Card } from '../lib/api'

function card(overrides: Partial<Card> = {}): Card {
  return { level: 2, unlocked: true, opened: false, clue: 'Behind the coffee machine', ...overrides }
}

describe('ScratchCard', () => {
  it('shows a padlock and no clue for a locked card', () => {
    render(<ScratchCard card={card({ unlocked: false, clue: null })} isCurrent={false} onOpen={vi.fn()} />)
    expect(screen.getByText(/locked/i)).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('shows the clue outright once opened', () => {
    render(<ScratchCard card={card({ opened: true })} isCurrent onOpen={vi.fn()} />)
    expect(screen.getByText('Behind the coffee machine')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers a reveal control for an unopened card and reports the open once', async () => {
    const onOpen = vi.fn()
    render(<ScratchCard card={card()} isCurrent onOpen={onOpen} />)
    const button = screen.getByRole('button', { name: /scratch|reveal/i })
    await userEvent.click(button)
    await userEvent.click(button)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(2)
  })

  it('keeps the clue in the accessibility tree while still covered', () => {
    render(<ScratchCard card={card()} isCurrent onOpen={vi.fn()} />)
    expect(screen.getByText('Behind the coffee machine')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/player/ScratchCard.test.tsx`
Expected: FAIL — cannot resolve `./ScratchCard`.

- [ ] **Step 3: Write the sprites**

```tsx
// src/player/sprites.tsx
type Props = { className?: string }

/** Pixel sprites drawn on a 16-unit grid so they stay crisp when scaled. */
const grid = (paths: [string, string][], className?: string) => (
  <svg className={className} viewBox="0 0 16 16" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
    {paths.map(([d, fill]) => (
      <path key={d + fill} d={d} fill={fill} />
    ))}
  </svg>
)

export const ChestSprite = ({ className }: Props) =>
  grid(
    [
      ['M2 6h12v8H2z', '#8a4b12'],
      ['M3 3h10v3H3z', '#c98b2e'],
      ['M2 6h12v2H2z', '#ffd400'],
      ['M7 7h2v4H7z', '#ffd400'],
      ['M7 8h2v2H7z', '#8a4b12'],
      ['M2 14h12v1H2z', '#5a2f08'],
    ],
    className,
  )

export const LockSprite = ({ className }: Props) =>
  grid(
    [
      ['M5 7h6v7H5z', '#9aa0b5'],
      ['M6 3h4v4H6z', '#6f7590'],
      ['M7 4h2v3H7z', '#0b0b12'],
      ['M7 9h2v3H7z', '#0b0b12'],
    ],
    className,
  )

export const CoinSprite = ({ className }: Props) =>
  grid(
    [
      ['M5 3h6v10H5z', '#ffd400'],
      ['M4 5h1v6H4zM11 5h1v6h-1z', '#c9a400'],
      ['M7 5h2v6H7z', '#fff6b0'],
    ],
    className,
  )

export const GhostSprite = ({ className }: Props) =>
  grid(
    [
      ['M4 5h8v8H4z', '#ff3b30'],
      ['M5 3h6v2H5z', '#ff3b30'],
      ['M4 13h2v2H4zM8 13h2v2H8z', '#ff3b30'],
      ['M6 6h2v3H6zM10 6h2v3h-2z', '#ffffff'],
      ['M7 7h1v2H7zM11 7h1v2h-1z', '#2121de'],
    ],
    className,
  )

export const FlagSprite = ({ className }: Props) =>
  grid(
    [
      ['M4 2h1v12H4z', '#9aa0b5'],
      ['M5 3h7v4H5z', '#33ffff'],
      ['M5 3h7v1H5z', '#ffffff'],
    ],
    className,
  )
```

- [ ] **Step 4: Write the component**

```tsx
// src/player/ScratchCard.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Card } from '../lib/api'
import { CoinSprite, LockSprite } from './sprites'

type Props = {
  card: Card
  isCurrent: boolean
  onOpen: (level: number) => void
}

const REVEAL_AT = 0.55
const BRUSH = 22

export default function ScratchCard({ card, isCurrent, onOpen }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [scratching, setScratching] = useState(false)
  const [revealed, setRevealed] = useState(card.opened)
  const [canScratch, setCanScratch] = useState(false)
  const reported = useRef(card.opened)

  const report = useCallback(() => {
    if (reported.current) return
    reported.current = true
    onOpen(card.level)
  }, [card.level, onOpen])

  // Paint the foil. jsdom and reduced-motion users get the button fallback.
  useEffect(() => {
    if (card.opened || !card.unlocked) return
    const canvas = canvasRef.current
    const context = canvas?.getContext?.('2d')
    if (!canvas || !context) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    const { width, height } = canvas.getBoundingClientRect()
    canvas.width = Math.max(1, Math.floor(width))
    canvas.height = Math.max(1, Math.floor(height))
    context.fillStyle = '#2121de'
    context.fillRect(0, 0, canvas.width, canvas.height)
    // Dither dots so the foil reads as pixel art rather than a flat block
    context.fillStyle = '#4a4aff'
    for (let y = 0; y < canvas.height; y += 6) {
      for (let x = (y / 6) % 2 === 0 ? 0 : 3; x < canvas.width; x += 6) {
        context.fillRect(x, y, 3, 3)
      }
    }
    setCanScratch(true)
  }, [card.opened, card.unlocked])

  const scratchAt = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (!canvas || !context) return
      const box = canvas.getBoundingClientRect()
      const x = ((event.clientX - box.left) / box.width) * canvas.width
      const y = ((event.clientY - box.top) / box.height) * canvas.height
      context.globalCompositeOperation = 'destination-out'
      context.beginPath()
      context.arc(x, y, BRUSH, 0, Math.PI * 2)
      context.fill()
      report()

      // Sample a downscaled copy rather than the full bitmap each stroke
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
      let clear = 0
      for (let i = 3; i < data.length; i += 4 * 64) {
        if (data[i] === 0) clear++
      }
      if (clear / (data.length / (4 * 64)) >= REVEAL_AT) setRevealed(true)
    },
    [report],
  )

  if (!card.unlocked) {
    return (
      <div className="card card-locked">
        <LockSprite className="sprite" />
        <span className="card-level">{card.level}</span>
        <span className="card-state">Locked</span>
      </div>
    )
  }

  const showFoil = !revealed

  return (
    <div className={`card card-unlocked${isCurrent ? ' card-current' : ''}`}>
      <span className="card-level">
        <CoinSprite className="sprite sprite-sm" />
        {card.level}
      </span>
      <p className="card-clue">{card.clue}</p>
      {showFoil && canScratch && (
        <canvas
          ref={canvasRef}
          className="card-foil"
          onPointerDown={event => {
            setScratching(true)
            event.currentTarget.setPointerCapture(event.pointerId)
            scratchAt(event)
          }}
          onPointerMove={event => scratching && scratchAt(event)}
          onPointerUp={() => setScratching(false)}
        />
      )}
      {showFoil && !canScratch && (
        <button
          type="button"
          className="card-reveal"
          onClick={() => {
            report()
            setRevealed(true)
          }}
        >
          Scratch to reveal
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/player/ScratchCard.test.tsx`
Expected: PASS, 4 tests (jsdom has no 2d context, so the button path is what gets exercised).

- [ ] **Step 6: Commit**

```bash
git add src/player/ScratchCard.tsx src/player/ScratchCard.test.tsx src/player/sprites.tsx
git commit -m "feat: scratch card with canvas foil and accessible reveal fallback"
```

---

## Task 10: Card grid, race HUD and elimination screen

**Files:**
- Create: `src/player/CardGrid.tsx`, `src/player/RaceStatus.tsx`, `src/player/EliminatedScreen.tsx`
- Modify: `src/player/PlayerApp.tsx`, `src/player/FinishedScreen.tsx`, `src/player/PlayerApp.test.tsx`
- Delete: `src/player/GameScreen.tsx`, `src/player/ChestIcon.tsx`

**Interfaces:**
- Consumes: `usePlayerGame` (Task 8), `ScratchCard` + sprites (Task 9).
- Produces: `<CardGrid view={TeamView} feedback={Feedback|null} busy={boolean} onSubmit={(code:string)=>void} onOpen={(level:number)=>void} />`, `<RaceStatus race={Race} />`, `<EliminatedScreen view={TeamView} />`.

- [ ] **Step 1: Write the failing test**

Rewrite `src/player/PlayerApp.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PlayerApp from './PlayerApp'
import * as api from '../lib/api'
import type { TeamView } from '../lib/api'

vi.mock('../lib/api', () => ({
  teamView: vi.fn(),
  submitCode: vi.fn(),
  openCard: vi.fn(),
  subscribeToGame: vi.fn(() => () => {}),
}))

const mockedView = vi.mocked(api.teamView)
const mockedSubmit = vi.mocked(api.submitCode)
const mockedOpen = vi.mocked(api.openCard)

function view(overrides: Partial<TeamView> = {}): TeamView {
  return {
    ok: true,
    team_name: 'Team 1',
    game_status: 'live',
    status: 'playing',
    cleared: 1,
    total: 3,
    out_at_level: null,
    place: null,
    race: { level: 2, slots: 2, taken: 1 },
    cards: [
      { level: 1, unlocked: true, opened: true, clue: 'Under the plant' },
      { level: 2, unlocked: true, opened: false, clue: 'Behind the fridge' },
      { level: 3, unlocked: false, opened: false, clue: null },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

async function loginAs(v: TeamView) {
  mockedView.mockResolvedValue(v)
  render(<PlayerApp />)
  await userEvent.type(screen.getByLabelText(/team code/i), 'ALPHA1')
  await userEvent.click(screen.getByRole('button', { name: /let's hunt/i }))
}

describe('PlayerApp', () => {
  it('shows one card per level with locked cards hidden', async () => {
    await loginAs(view())
    expect(await screen.findByText('Under the plant')).toBeInTheDocument()
    expect(screen.getAllByText(/locked/i)).toHaveLength(1)
  })

  it('shows the live race count', async () => {
    await loginAs(view())
    expect(await screen.findByText(/1 of 2 codes found/i)).toBeInTheDocument()
    expect(screen.getByText(/1 slot left/i)).toBeInTheDocument()
  })

  it('warns when only one slot remains', async () => {
    await loginAs(view({ race: { level: 2, slots: 2, taken: 1 } }))
    expect(await screen.findByText(/1 slot left/i)).toHaveClass('race-urgent')
  })

  it('reports a scratch to the server', async () => {
    mockedOpen.mockResolvedValue({ ok: true, level: 2, clue: 'Behind the fridge', view: view() })
    await loginAs(view())
    await userEvent.click(await screen.findByRole('button', { name: /scratch to reveal/i }))
    expect(mockedOpen).toHaveBeenCalledWith('ALPHA1', 2)
  })

  it('submits a code and renders the returned view', async () => {
    await loginAs(view())
    mockedSubmit.mockResolvedValue({ ok: true, correct: true, view: view({ cleared: 2, race: { level: 3, slots: 1, taken: 0 } }) })
    await userEvent.type(screen.getByLabelText(/enter code/i), 'CODE2')
    await userEvent.click(screen.getByRole('button', { name: /submit code/i }))
    expect(await screen.findByText(/code cracked/i)).toBeInTheDocument()
  })

  it('shows the too-late message when the slots filled first', async () => {
    await loginAs(view())
    mockedSubmit.mockResolvedValue({
      ok: true, correct: false, reason: 'too_late',
      view: view({ status: 'eliminated', out_at_level: 2, race: null, place: 3 }),
    })
    await userEvent.type(screen.getByLabelText(/enter code/i), 'CODE2')
    await userEvent.click(screen.getByRole('button', { name: /submit code/i }))
    expect(await screen.findByText(/game over/i)).toBeInTheDocument()
  })

  it('switches to the eliminated screen with the level reached', async () => {
    await loginAs(view({ status: 'eliminated', out_at_level: 2, race: null, place: 3 }))
    expect(await screen.findByText(/game over/i)).toBeInTheDocument()
    expect(screen.getByText(/other teams found all the codes/i)).toBeInTheDocument()
    expect(screen.getByText(/clue 2 of 3/i)).toBeInTheDocument()
  })

  it('celebrates the winner', async () => {
    await loginAs(view({ status: 'winner', cleared: 3, race: null, place: 1 }))
    expect(await screen.findByText(/treasure found/i)).toBeInTheDocument()
  })

  it('shows the placing for a later finisher', async () => {
    await loginAs(view({ status: 'finished', cleared: 3, race: null, place: 2 }))
    expect(await screen.findByText(/2nd/i)).toBeInTheDocument()
  })

  it('waits for kickoff when the game is in setup', async () => {
    await loginAs(view({ game_status: 'setup', race: null }))
    expect(await screen.findByText(/hasn't started/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/player/PlayerApp.test.tsx`
Expected: FAIL — `teamLogin` no longer exists / CardGrid missing.

- [ ] **Step 3: Write RaceStatus**

```tsx
// src/player/RaceStatus.tsx
import type { Race } from '../lib/api'

export default function RaceStatus({ race }: { race: Race }) {
  const left = Math.max(race.slots - race.taken, 0)
  const urgent = left <= 1
  return (
    <div className="race-status" role="status">
      <span className="race-count">
        {race.taken} of {race.slots} codes found
      </span>
      <span className={urgent ? 'race-left race-urgent' : 'race-left'}>
        {left === 0 ? 'slots gone!' : `${left} slot${left === 1 ? '' : 's'} left`}
      </span>
    </div>
  )
}
```

- [ ] **Step 4: Write CardGrid**

```tsx
// src/player/CardGrid.tsx
import { useEffect, useState, type FormEvent } from 'react'
import type { TeamView } from '../lib/api'
import type { Feedback } from './usePlayerGame'
import ScratchCard from './ScratchCard'
import RaceStatus from './RaceStatus'

type Props = {
  view: TeamView
  feedback: Feedback | null
  busy: boolean
  onSubmit: (code: string) => void
  onOpen: (level: number) => void
}

export default function CardGrid({ view, feedback, busy, onSubmit, onOpen }: Props) {
  const [code, setCode] = useState('')
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (feedback?.kind === 'cooldown') setCooldown(feedback.seconds)
    if (feedback?.kind === 'correct') setCode('')
  }, [feedback])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!code.trim() || busy || cooldown > 0) return
    onSubmit(code)
  }

  const message = (() => {
    if (cooldown > 0) return { className: 'msg msg-warn', text: `Hold on — try again in ${cooldown}s.` }
    if (!feedback) return null
    switch (feedback.kind) {
      case 'wrong':
        return { className: 'msg msg-bad shake', text: 'Wrong code. Keep hunting!' }
      case 'already_used':
        return { className: 'msg msg-warn', text: "You've used that one — follow your newest clue!" }
      case 'correct':
        return { className: 'msg msg-good', text: 'Code cracked! Next card unlocked.' }
      case 'too_late':
        return { className: 'msg msg-bad', text: 'Too late — that race just filled up.' }
      case 'error':
        return { className: 'msg msg-bad', text: feedback.message }
      case 'cooldown':
        return null
    }
  })()

  const currentLevel = view.cleared + 1

  return (
    <div className="player-screen">
      <header className="player-header">
        <span className="team-chip">{view.team_name}</span>
        <span className="progress-label">
          Level {Math.min(currentLevel, view.total)} of {view.total}
        </span>
      </header>

      {view.race && <RaceStatus race={view.race} />}

      <div className="card-grid">
        {view.cards.map(card => (
          <ScratchCard
            key={card.level}
            card={card}
            isCurrent={card.level === currentLevel}
            onOpen={onOpen}
          />
        ))}
      </div>

      <form onSubmit={handleSubmit} className="code-form">
        <div className="float-field">
          <input
            id="code-input"
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="e.g. TIGER42"
            autoComplete="off"
            autoCapitalize="characters"
          />
          <label htmlFor="code-input">Enter code</label>
          <fieldset aria-hidden="true"><legend><span>Enter code</span></legend></fieldset>
        </div>
        <button type="submit" disabled={busy || cooldown > 0 || !code.trim()}>
          {cooldown > 0 ? `Wait ${cooldown}s…` : 'Submit code'}
        </button>
      </form>

      {message && <p className={message.className} role="status">{message.text}</p>}
    </div>
  )
}
```

- [ ] **Step 5: Write EliminatedScreen**

```tsx
// src/player/EliminatedScreen.tsx
import type { TeamView } from '../lib/api'
import { ordinal } from '../lib/ordinal'
import { GhostSprite } from './sprites'

export default function EliminatedScreen({ view }: { view: TeamView }) {
  return (
    <div className="player-screen center-screen eliminated">
      <GhostSprite className="sprite sprite-xl" />
      <h1>GAME OVER</h1>
      <p className="eliminated-why">
        You're out of the competition — the other teams found all the codes first.
      </p>
      <p className="rank-line">
        You reached clue {view.out_at_level ?? view.cleared + 1} of {view.total}
        {view.place !== null ? ` · ${ordinal(view.place)} place` : ''}
      </p>
    </div>
  )
}
```

- [ ] **Step 6: Rewrite PlayerApp routing**

```tsx
// src/player/PlayerApp.tsx
import { usePlayerGame } from './usePlayerGame'
import LoginScreen from './LoginScreen'
import CardGrid from './CardGrid'
import WaitingScreen from './WaitingScreen'
import FinishedScreen from './FinishedScreen'
import EliminatedScreen from './EliminatedScreen'

export default function PlayerApp() {
  const game = usePlayerGame()

  if (game.restoring) return <div className="center-screen">Loading…</div>
  if (!game.view) return <LoginScreen onLogin={game.login} error={game.loginError} busy={game.busy} />

  const view = game.view
  if (view.status === 'eliminated') return <EliminatedScreen view={view} />
  if (view.status === 'winner' || view.status === 'finished') return <FinishedScreen view={view} />
  if (view.game_status !== 'live') return <WaitingScreen status={view.game_status} teamName={view.team_name} />
  return (
    <CardGrid
      view={view}
      feedback={game.feedback}
      busy={game.busy}
      onSubmit={game.submit}
      onOpen={game.openCard}
    />
  )
}
```

- [ ] **Step 7: Update FinishedScreen for the new view shape**

```tsx
// src/player/FinishedScreen.tsx
import type { TeamView } from '../lib/api'
import { ordinal } from '../lib/ordinal'
import { ChestSprite } from './sprites'

export default function FinishedScreen({ view }: { view: TeamView }) {
  const won = view.status === 'winner'
  return (
    <div className="player-screen center-screen treasure">
      <ChestSprite className="sprite sprite-xl" />
      <h1>{won ? 'TREASURE FOUND!' : 'TREASURE CLAIMED'}</h1>
      <p className="rank-line">
        {view.team_name} finished{view.place !== null ? ` ${ordinal(view.place)}` : ''}!
      </p>
      <p>Head back to the game master to celebrate.</p>
    </div>
  )
}
```

- [ ] **Step 8: Delete the old screen and icon**

```bash
git rm src/player/GameScreen.tsx src/player/ChestIcon.tsx
```

- [ ] **Step 9: Run the tests**

Run: `npx vitest run src && npx tsc --noEmit`
Expected: player tests PASS (11 cases). `tsc` still fails in admin files — Tasks 11–14.

- [ ] **Step 10: Commit**

```bash
git add src/player
git commit -m "feat: scratch-card grid, live race HUD and elimination screen"
```

---

## Task 11: Admin dashboard

**Files:**
- Create: `src/admin/Dashboard.tsx`, `src/admin/useMonitor.ts`, `src/admin/Dashboard.test.tsx`
- Modify: `src/admin/adminApi.ts`, `src/admin/AdminApp.tsx`
- Delete: `src/admin/LiveBoard.tsx`, `src/admin/LiveBoard.test.tsx`, `src/admin/useAdminBoard.ts`, `src/admin/sortBoard.ts`, `src/admin/sortBoard.test.ts`

**Interfaces:**
- Consumes: `admin_monitor` view (Task 7), `comparePlacement` + `setupWarning` (Task 1), `subscribeToGame` (Task 8).
- Produces: `type MonitorRow = { id: string; name: string; team_code: string; status: TeamStatus; cleared_level: number; out_at_level: number | null; finished_at: string | null; eliminated_at: string | null; created_at: string; started: boolean; max_opened_level: number | null; last_solve_at: string | null; wrong_count: number }`; `fetchMonitor(): Promise<MonitorRow[]>`; `generateTeams(count: number): Promise<AdminRpcResult>`; `useMonitor()` returning `{ rows, levels, game, error, loading }`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/admin/Dashboard.test.tsx
import { render, screen } from '@testing-library/react'
import Dashboard from './Dashboard'
import { useMonitor } from './useMonitor'
import type { MonitorRow } from './adminApi'

vi.mock('./useMonitor', () => ({ useMonitor: vi.fn() }))

function row(overrides: Partial<MonitorRow>): MonitorRow {
  return {
    id: Math.random().toString(36).slice(2),
    name: 'Team',
    team_code: 'ALPHA1',
    status: 'playing',
    cleared_level: 0,
    out_at_level: null,
    finished_at: null,
    eliminated_at: null,
    created_at: '2026-08-20T09:00:00Z',
    started: false,
    max_opened_level: null,
    last_solve_at: null,
    wrong_count: 0,
    ...overrides,
  }
}

function mount(rows: MonitorRow[], levels = 3) {
  vi.mocked(useMonitor).mockReturnValue({
    rows,
    levels,
    game: { id: 1, status: 'live', started_at: null, ended_at: null, initial_team_count: rows.length },
    error: null,
    loading: false,
  })
  render(<Dashboard />)
}

describe('Dashboard', () => {
  it('separates started teams from those yet to open card 1', () => {
    mount([
      row({ name: 'Movers', started: true, max_opened_level: 2, cleared_level: 1 }),
      row({ name: 'Sleepers', started: false }),
    ])
    expect(screen.getByText('Movers').closest('tr')).toHaveTextContent(/started/i)
    expect(screen.getByText('Sleepers').closest('tr')).toHaveTextContent(/not started/i)
  })

  it('shows how far each team has opened and cleared', () => {
    mount([row({ name: 'Movers', started: true, max_opened_level: 3, cleared_level: 2 })])
    const tr = screen.getByText('Movers').closest('tr')!
    expect(tr).toHaveTextContent('3')
    expect(tr).toHaveTextContent('2')
  })

  it('flags teams that failed to find a code with the level they went out at', () => {
    mount([row({ name: 'Stragglers', status: 'eliminated', out_at_level: 2, cleared_level: 1 })])
    expect(screen.getByText('Stragglers').closest('tr')).toHaveTextContent(/out at 2/i)
  })

  it('highlights the winner', () => {
    mount([row({ name: 'Champs', status: 'winner', cleared_level: 3, finished_at: '2026-08-20T10:00:00Z' })])
    expect(screen.getByText('Champs').closest('tr')).toHaveClass('row-winner')
  })

  it('summarises the current race', () => {
    mount([
      row({ name: 'A', cleared_level: 1, started: true }),
      row({ name: 'B', cleared_level: 0, started: true }),
      row({ name: 'C', cleared_level: 0, started: true }),
    ])
    expect(screen.getByText(/3 teams alive/i)).toBeInTheDocument()
  })

  it('warns when levels and teams do not line up', () => {
    mount([row({ name: 'A' }), row({ name: 'B' }), row({ name: 'C' }), row({ name: 'D' }), row({ name: 'E' })], 3)
    expect(screen.getByText(/teams will claim the treasure together/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/admin/Dashboard.test.tsx`
Expected: FAIL — cannot resolve `./Dashboard`.

- [ ] **Step 3: Extend adminApi**

In `src/admin/adminApi.ts`: delete `fetchBoard`, `BoardRow`, `setTeamPosition`, `makeFinal`, `generateRoutes`, `fetchRoutePreview`, `RoutePreview`, and the `is_final` field in `StationRow`/`fetchStations`. Add:

```ts
import type { TeamStatus } from '../lib/api'

export type MonitorRow = {
  id: string
  name: string
  team_code: string
  status: TeamStatus
  cleared_level: number
  out_at_level: number | null
  finished_at: string | null
  eliminated_at: string | null
  created_at: string
  started: boolean
  max_opened_level: number | null
  last_solve_at: string | null
  wrong_count: number
}

export async function fetchMonitor(): Promise<MonitorRow[]> {
  const { data, error } = await supabase.from('admin_monitor').select('*')
  if (error) throw error
  return data as MonitorRow[]
}

export async function countStations(): Promise<number> {
  const { count, error } = await supabase.from('stations').select('id', { count: 'exact', head: true })
  if (error) throw error
  return count ?? 0
}

export const generateTeams = (count: number): Promise<AdminRpcResult> =>
  adminRpc('generate_teams', { p_count: count })
```

Also widen `GameRow` with `initial_team_count: number | null`.

- [ ] **Step 4: Write useMonitor**

```ts
// src/admin/useMonitor.ts
import { useCallback, useEffect, useState } from 'react'
import { subscribeToGame } from '../lib/api'
import { comparePlacement } from '../lib/rounds'
import { countStations, fetchGame, fetchMonitor, type GameRow, type MonitorRow } from './adminApi'

export function useMonitor() {
  const [rows, setRows] = useState<MonitorRow[]>([])
  const [levels, setLevels] = useState(0)
  const [game, setGame] = useState<GameRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [monitor, stationCount, gameRow] = await Promise.all([fetchMonitor(), countStations(), fetchGame()])
      setRows([...monitor].sort(comparePlacement))
      setLevels(stationCount)
      setGame(gameRow)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the board')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const unsubscribe = subscribeToGame(() => { void load() })
    const interval = setInterval(load, 15_000)
    return () => {
      unsubscribe()
      clearInterval(interval)
    }
  }, [load])

  return { rows, levels, game, error, loading }
}
```

- [ ] **Step 5: Write Dashboard**

```tsx
// src/admin/Dashboard.tsx
import { setupWarning, slotsForLevel } from '../lib/rounds'
import { timeAgo } from './timeAgo'
import { useMonitor } from './useMonitor'

export default function Dashboard() {
  const { rows, levels, game, error, loading } = useMonitor()

  const alive = rows.filter(r => r.status !== 'eliminated')
  const racing = rows.filter(r => r.status === 'playing')
  const raceLevel = racing.length ? Math.min(...racing.map(r => r.cleared_level)) + 1 : null
  const slots = raceLevel ? slotsForLevel(raceLevel, alive.length) : 0
  const taken = raceLevel ? rows.filter(r => r.cleared_level >= raceLevel).length : 0
  const warning = setupWarning(levels, rows.length)

  return (
    <section className="control-layout">
      <h1>Game dashboard</h1>
      {error && <p className="msg msg-bad" role="alert">{error}</p>}
      {loading && <p className="hint">Loading…</p>}

      <div className="card hud">
        <p className="hud-line">
          <strong className={`status status-${game?.status ?? 'setup'}`}>{game?.status ?? 'setup'}</strong>
          {' · '}
          {racing.length} teams alive of {rows.length}
          {raceLevel !== null && ` · racing clue ${raceLevel}: ${taken} of ${slots} slots taken`}
        </p>
        <p className={warning ? 'msg msg-warn' : 'hint'}>
          {warning ?? `${levels} clues for ${rows.length} teams — set up to end on one winner.`}
        </p>
      </div>

      <div className="card">
        <table className="board-table">
          <thead>
            <tr>
              <th>Team</th>
              <th>Start</th>
              <th>Opened</th>
              <th>Cleared</th>
              <th>State</th>
              <th>Last code</th>
              <th>Misses</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr
                key={row.id}
                className={
                  row.status === 'winner' ? 'row-winner'
                  : row.status === 'eliminated' ? 'row-out'
                  : !row.started ? 'row-idle'
                  : undefined
                }
              >
                <td>{row.name}</td>
                <td>{row.started ? 'Started' : 'Not started'}</td>
                <td>{row.max_opened_level ?? '—'}</td>
                <td>{row.cleared_level}</td>
                <td>
                  {row.status === 'eliminated'
                    ? `Out at ${row.out_at_level}`
                    : row.status === 'winner'
                      ? 'Winner'
                      : row.status === 'finished'
                        ? 'Finished'
                        : 'Playing'}
                </td>
                <td>{row.last_solve_at ? timeAgo(row.last_solve_at) : '—'}</td>
                <td>{row.wrong_count}</td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr><td colSpan={7} className="empty">No teams yet — add them on the Teams page.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
```

- [ ] **Step 6: Swap the route and delete the old board**

In `src/admin/AdminApp.tsx` replace the `LiveBoard` import and `<Route index element={<LiveBoard />} />` with `Dashboard`, and rename the nav link to `Dashboard`.

```bash
git rm src/admin/LiveBoard.tsx src/admin/LiveBoard.test.tsx src/admin/useAdminBoard.ts src/admin/sortBoard.ts src/admin/sortBoard.test.ts
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/admin`
Expected: Dashboard PASS (6 cases). `AdminApp.test.tsx` may need its LiveBoard expectation renamed to Dashboard.

- [ ] **Step 8: Commit**

```bash
git add src/admin src/lib
git commit -m "feat: single-page admin dashboard with live monitor rows"
```

---

## Task 12: Team count generator

**Files:**
- Modify: `src/admin/TeamsPanel.tsx`, `src/admin/TeamsPanel.test.tsx`

**Interfaces:**
- Consumes: `generateTeams` (Task 11).
- Produces: no new exports; a `Number of teams` numeric input plus a `Generate teams` button in the existing panel.

- [ ] **Step 1: Write the failing test**

Add to `src/admin/TeamsPanel.test.tsx`:

```tsx
it('generates teams from a count', async () => {
  vi.mocked(adminApi.generateTeams).mockResolvedValue({ ok: true, created: 3, total: 3 })
  render(<TeamsPanel />)
  await userEvent.clear(screen.getByLabelText(/number of teams/i))
  await userEvent.type(screen.getByLabelText(/number of teams/i), '3')
  await userEvent.click(screen.getByRole('button', { name: /generate teams/i }))
  expect(adminApi.generateTeams).toHaveBeenCalledWith(3)
  expect(await screen.findByText(/added 3 teams/i)).toBeInTheDocument()
})

it('surfaces the refusal when the game is already live', async () => {
  vi.mocked(adminApi.generateTeams).mockResolvedValue({ ok: false, error: 'game_live' })
  render(<TeamsPanel />)
  await userEvent.clear(screen.getByLabelText(/number of teams/i))
  await userEvent.type(screen.getByLabelText(/number of teams/i), '4')
  await userEvent.click(screen.getByRole('button', { name: /generate teams/i }))
  expect(await screen.findByText(/end or reset the game first/i)).toBeInTheDocument()
})
```

Make sure the existing `vi.mock('./adminApi', …)` factory in that file also stubs `generateTeams`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/admin/TeamsPanel.test.tsx`
Expected: FAIL — no `number of teams` label.

- [ ] **Step 3: Add the generator to TeamsPanel**

Insert above the existing add-team form, reusing the panel's existing `reload`/`error` state:

```tsx
const [count, setCount] = useState('')
const [note, setNote] = useState<string | null>(null)

async function handleGenerate(event: FormEvent) {
  event.preventDefault()
  const parsed = Number(count)
  if (!Number.isInteger(parsed) || parsed < 1) {
    setNote('Enter a whole number of teams, 1 or more.')
    return
  }
  const result = await generateTeams(parsed)
  if (!result.ok) {
    setNote(result.error === 'game_live'
      ? 'End or reset the game first — teams are locked while it runs.'
      : 'That team count looks off. Try a number between 1 and 50.')
    return
  }
  setNote(`Added ${result.created} teams — ${result.total} in total.`)
  await reload()
}
```

```tsx
<form className="inline-form" onSubmit={handleGenerate}>
  <div>
    <label htmlFor="team-count">Number of teams</label>
    <input id="team-count" type="number" min={1} max={50} value={count}
      onChange={e => setCount(e.target.value)} />
  </div>
  <button type="submit">Generate teams</button>
</form>
{note && <p className="msg msg-warn">{note}</p>}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/admin/TeamsPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/admin/TeamsPanel.tsx src/admin/TeamsPanel.test.tsx
git commit -m "feat: generate teams from a count"
```

---

## Task 13: Station levels and code validation

**Files:**
- Modify: `src/admin/StationsPanel.tsx`, `src/admin/StationsPanel.test.tsx`, `src/admin/PrintPage.tsx`, `src/admin/PrintPage.test.tsx`

**Interfaces:**
- Consumes: `fetchStations`/`createStation`/`updateStation` without `is_final` (Task 11).
- Produces: no new exports. The panel labels the order column **Level**, rejects malformed codes client-side, and shows a contiguity warning.

- [ ] **Step 1: Write the failing test**

Add to `src/admin/StationsPanel.test.tsx`:

```tsx
it('labels the ordering column as level', async () => {
  vi.mocked(adminApi.fetchStations).mockResolvedValue([
    { id: '1', name: 'Kitchen', clue_text: 'Where the mugs live', code: 'KITCH1', sort_order: 1 },
  ])
  render(<StationsPanel />)
  expect(await screen.findByText(/level/i)).toBeInTheDocument()
})

it('rejects a code with a space or symbol before saving', async () => {
  vi.mocked(adminApi.fetchStations).mockResolvedValue([])
  render(<StationsPanel />)
  await userEvent.type(screen.getByLabelText(/name/i), 'Kitchen')
  await userEvent.type(screen.getByLabelText(/clue/i), 'Where the mugs live')
  await userEvent.type(screen.getByLabelText(/code/i), 'NOT OK!')
  await userEvent.click(screen.getByRole('button', { name: /add station/i }))
  expect(await screen.findByText(/letters and numbers only/i)).toBeInTheDocument()
  expect(adminApi.createStation).not.toHaveBeenCalled()
})

it('warns when levels are not contiguous from 1', async () => {
  vi.mocked(adminApi.fetchStations).mockResolvedValue([
    { id: '1', name: 'A', clue_text: 'a', code: 'AAA1', sort_order: 1 },
    { id: '2', name: 'C', clue_text: 'c', code: 'CCC3', sort_order: 3 },
  ])
  render(<StationsPanel />)
  expect(await screen.findByText(/levels must run 1 to 2/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/admin/StationsPanel.test.tsx`
Expected: FAIL — still renders "Order" and accepts any code.

- [ ] **Step 3: Implement**

- Drop every `is_final` reference and the "Make final" button.
- Rename the column header and the input label to `Level`.
- Before calling `createStation`/`updateStation`, validate with `const CODE = /^[A-Z0-9]{3,12}$/` against the upper-cased, trimmed value, and show `Codes are letters and numbers only, 3–12 characters.` on failure.
- Compute contiguity from the loaded rows and render `Levels must run 1 to ${rows.length} with no gaps.` when `min !== 1 || max !== rows.length`.
- In `PrintPage.tsx`, replace the `is_final` branch with `Level ${station.sort_order}` on each station sheet, and mark the highest level `· FINAL TREASURE`. Update `PrintPage.test.tsx` fixtures to drop `is_final`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/admin && npx tsc --noEmit`
Expected: PASS and a clean typecheck across the repo.

- [ ] **Step 5: Commit**

```bash
git add src/admin
git commit -m "feat: stations are levels, with code validation and gap warnings"
```

---

## Task 14: Game control copy

**Files:**
- Modify: `src/admin/GameControl.tsx`, `src/admin/GameControl.test.tsx`

**Interfaces:**
- Consumes: `startGame` results from Task 7.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Add to `src/admin/GameControl.test.tsx`:

```tsx
it('explains a level gap in plain language', async () => {
  vi.mocked(adminApi.startGame).mockResolvedValue({ ok: false, error: 'level_gap' })
  render(<GameControl />)
  await userEvent.click(await screen.findByRole('button', { name: /start/i }))
  expect(await screen.findByText(/levels must run 1, 2, 3/i)).toBeInTheDocument()
})

it('reports the shape of the game it just started', async () => {
  vi.mocked(adminApi.startGame).mockResolvedValue({ ok: true, status: 'live', teams: 4, levels: 4 })
  render(<GameControl />)
  await userEvent.click(await screen.findByRole('button', { name: /start/i }))
  expect(await screen.findByText(/4 teams · 4 clues/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/admin/GameControl.test.tsx`
Expected: FAIL — unknown error code renders the generic fallback.

- [ ] **Step 3: Implement**

- Remove the `Generate routes` button, the route preview, and the `no_final_station` / `teams_missing_routes` error strings.
- Map the new errors:
  - `no_stations` → `Add at least one clue level before starting.`
  - `no_teams` → `Add teams before starting.`
  - `level_gap` → `Levels must run 1, 2, 3… with no gaps. Fix the Stations page first.`
  - `not_in_setup` → keep the existing copy.
- On success show `Live · ${teams} teams · ${levels} clues`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/admin/GameControl.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/admin/GameControl.tsx src/admin/GameControl.test.tsx
git commit -m "feat: game control copy for level guards, routes gone"
```

---

## Task 15: Arcade skin

**Files:**
- Modify: `src/index.css`, `index.html`
- Verify: headless screenshots of login, card grid, eliminated, dashboard

**Interfaces:**
- Consumes: class names emitted by Tasks 9–13 (`card-grid`, `card`, `card-locked`, `card-current`, `card-foil`, `card-reveal`, `card-level`, `card-clue`, `race-status`, `race-count`, `race-left`, `race-urgent`, `sprite`, `sprite-sm`, `sprite-xl`, `hud`, `hud-line`, `row-winner`, `row-out`, `row-idle`, `eliminated`, `eliminated-why`).
- Produces: no exports.

- [ ] **Step 1: Add the pixel font**

In `index.html`, extend the existing Google Fonts link to request both families and set the dark theme colour:

```html
<meta name="theme-color" content="#0b0b12" />
<link
  href="https://fonts.googleapis.com/css2?family=Figtree:ital,wght@0,300..900;1,300..900&family=Press+Start+2P&display=swap"
  rel="stylesheet"
/>
```

- [ ] **Step 2: Replace the token block in `src/index.css`**

```css
:root {
  --bg: #0b0b12;
  --bg-2: #14142a;
  --panel: #16162c;
  --panel-2: #1e1e3a;
  --ink: #f4f4ff;
  --muted: #9aa0b5;
  --brand: #ffd400;          /* coin yellow: primary actions */
  --brand-dark: #c9a400;
  --maze: #2121de;           /* Pac-Man maze blue */
  --accent: #33ffff;         /* cyan */
  --accent-2: #ff5edb;       /* magenta */
  --good: #4ade80;
  --bad: #ff3b30;            /* ghost red */
  --warn: #ffb020;
  --line: #33335c;
  --radius: 0;
  --radius-sm: 0;
  --font-display: "Press Start 2P", "Courier New", monospace;
  --font-body: "Figtree", system-ui, -apple-system, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  --shadow-hard: 4px 4px 0 #000;
  --shadow-hard-sm: 3px 3px 0 #000;
}
```

- [ ] **Step 3: Restyle the shared primitives**

Rules to change, keeping every existing selector working:

- `body` — `background: var(--bg)`; replace the soft radial `body::before` with a scanline overlay: `repeating-linear-gradient(to bottom, rgb(255 255 255 / 0.04) 0 1px, transparent 1px 3px)`, `pointer-events: none`, `position: fixed; inset: 0; z-index: 1`.
- `h1, h2, h3` — `font-family: var(--font-display)`; `letter-spacing: 0.02em`; `line-height: 1.4`; never below `10px` (`h1 { font-size: clamp(1.1rem, 5vw, 1.6rem) }`).
- `button` — `font-family: var(--font-display)`; `font-size: 0.7rem`; `background: var(--brand)`; `color: #1a1400`; `border: 3px solid #000`; `box-shadow: var(--shadow-hard)`; on `:hover` translate `-1px,-1px` and grow the shadow to `5px 5px 0`; on `:active` translate `2px,2px` and drop the shadow to `1px 1px 0`; `transition: none` (steps, not easing).
- `input, textarea` — `background: #0f0f1e`; `color: var(--ink)`; `border: 3px solid var(--line)`; `box-shadow: none`; focus → `border-color: var(--accent)` plus `box-shadow: 0 0 0 3px rgb(51 255 255 / 0.25)`.
- `.float-field label` — `font-family: var(--font-display)`; `font-size: 0.55rem`; floated colour `var(--accent)`; `.float-field fieldset` — `background: #0f0f1e`; `border: 3px solid var(--line)`.
- `.card` / `.login-card` — `background: var(--panel)`; `border: 3px solid var(--line)`; `box-shadow: var(--shadow-hard)`; remove `backdrop-filter` and the rise-in animation's blur.
- `.msg-*` — dark tinted fills (`#2a1216` bad, `#12241a` good, `#2a2010` warn) with 3px borders in `--bad` / `--good` / `--warn` and matching text colour.
- `@keyframes` — add `steps(4, end)` to `float`, and replace the pulse/glow easings with a two-frame `blink` (`50% { opacity: 0.35 }`).

- [ ] **Step 4: Style the new components**

```css
/* ---------- Cards ---------- */
.card-grid {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.85rem;
}
.card {
  position: relative; min-height: 8.5rem; padding: 0.85rem;
  background: var(--panel-2); border: 3px solid var(--line);
  box-shadow: var(--shadow-hard-sm); overflow: hidden;
  display: flex; flex-direction: column; gap: 0.5rem;
}
.card-locked { align-items: center; justify-content: center; color: var(--muted); }
.card-locked .card-state {
  font-family: var(--font-display); font-size: 0.5rem; letter-spacing: 0.1em;
}
.card-current { border-color: var(--brand); animation: blink 1.6s steps(2, end) infinite; }
.card-level {
  display: inline-flex; align-items: center; gap: 0.35rem;
  font-family: var(--font-display); font-size: 0.6rem; color: var(--brand);
}
.card-clue { margin: 0; font-size: 0.95rem; line-height: 1.45; }
.card-foil {
  position: absolute; inset: 0; width: 100%; height: 100%;
  cursor: crosshair; touch-action: none;
}
.card-reveal {
  position: absolute; inset: 0; width: 100%; height: 100%;
  background: var(--maze); color: var(--ink); border: none; box-shadow: none;
  font-size: 0.6rem;
}

/* ---------- Race HUD ---------- */
.race-status {
  display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;
  padding: 0.6rem 0.75rem; background: #0f0f1e;
  border: 3px solid var(--maze); font-family: var(--font-display); font-size: 0.55rem;
}
.race-count { color: var(--accent); }
.race-left { color: var(--good); }
.race-urgent { color: var(--bad); animation: blink 0.9s steps(2, end) infinite; }

/* ---------- Sprites ---------- */
.sprite { width: 32px; height: 32px; image-rendering: pixelated; }
.sprite-sm { width: 14px; height: 14px; }
.sprite-xl { width: 96px; height: 96px; }

/* ---------- Eliminated ---------- */
.eliminated h1 { color: var(--bad); }
.eliminated-why { color: var(--muted); max-width: 34ch; }

/* ---------- Admin rows ---------- */
.hud-line { font-family: var(--font-display); font-size: 0.6rem; line-height: 1.8; margin: 0; }
.row-winner { background: #2a2410; }
.row-out { opacity: 0.55; }
.row-idle td:first-child::before { content: "● "; color: var(--warn); }
```

- [ ] **Step 5: Keep print on white paper**

Extend the existing `@media print` block:

```css
@media print {
  .admin-nav, .no-print { display: none !important; }
  .admin-main { max-width: none; padding: 0; }
  body { background: #fff; color: #000; }
  body::before { display: none; }
  .card, .print-card { background: #fff; color: #000; box-shadow: none; border-color: #333; }
  .print-section { grid-template-columns: repeat(2, 1fr); }
}
```

- [ ] **Step 6: Verify visually**

Start the dev server and screenshot each screen; **open each PNG and look at it** — a blank or unreadable frame is a failure:

```bash
npx vite --port 5199 &
'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' --headless=new --disable-gpu \
  --force-device-scale-factor=2 --virtual-time-budget=5000 --window-size=520,900 \
  --screenshot=/tmp/login.png 'http://[::1]:5199/'
```

Check: pixel font renders (not a fallback), body text is legible at arm's length, contrast holds on the neon-on-black pairs, and the card grid fits a 390px-wide viewport without horizontal scroll.

- [ ] **Step 7: Commit**

```bash
git add src/index.css index.html
git commit -m "feat: 8-bit arcade skin — neon on black, pixel chrome, hard shadows"
```

---

## Task 16: Docs and full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite the rules and runbook sections of `README.md`**

Cover: the slot formula and both end conditions; that levels and teams need not match and what each mismatch does; the admin flow (generate teams → add one station per level with contiguous levels → print → start); that scratching is server-recorded; and the local commands (`npx supabase start`, `npx supabase db reset`, `npm run test:unit`, `npm run test:integration`).

- [ ] **Step 2: Run the whole suite**

```bash
npx tsc --noEmit
npx vitest run src
npx supabase db reset && npx vitest run tests/integration --no-file-parallelism
npm run build
```

Expected: typecheck clean, all unit tests pass, all integration tests pass, production build succeeds.

- [ ] **Step 3: Play one game end to end by hand**

With three teams and three levels: start the game, log in as each team in three browser profiles, scratch card 1, submit `CODE1` for all three (nobody out), then submit `CODE2` for two teams and confirm the third flips to GAME OVER **without reloading**. Confirm the dashboard shows started/opened/cleared/out-at for each team as it happens.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: elimination rules and updated runbook"
```

---

## Self-Review

**Spec coverage:** slots and sweep (Tasks 1, 5); both end conditions (Task 5); card ladder and locked-clue hiding (Task 4); scratch tracking (Tasks 6, 9); live anonymous counter (Tasks 8, 10); eliminated screen (Task 10); team-count generator (Tasks 6, 12); admin single page with started / failed / opened-level (Tasks 7, 11); station levels and code format (Tasks 2, 3, 13); start/reset guards (Task 7); arcade skin including print (Task 15); realtime (Task 8); testing pyramid (every task); docs (Task 16).

**Known deviation from the spec:** the spec's `attempts` cleanup on `reset_game` is implemented in `reset_progress`, the RPC that already exists in this codebase — there is no separate `reset_game` function, and the plan does not add one.

---

# REVISION 2 — elimination removed

**Requested mid-implementation, after Task 14.** Every level now has a code for
every team: nobody is eliminated, and the first team to claim the treasure wins
while the rest keep playing for a placing.

**Execution order:** Tasks 17 → 18 → 19 → 20, THEN the arcade skin (Task 15),
THEN docs and final verification (Task 16). The skin comes after the rework so
it never styles a screen that is about to be deleted. Task 16's scope is
amended by Task 20.

**Spec:** `docs/superpowers/specs/2026-08-20-elimination-scratch-cards-design.md`
(revision 2 — read it, not this plan's earlier tasks, where they disagree).

## Revision 2 global constraints

- No elimination anywhere: no slots, no capacity check, no sweep, no
  `too_late`, no last-standing, no eliminated screen.
- Team status in play is `playing` | `winner` | `finished`. The `eliminated`
  value stays permitted by the shipped check constraint but must never be
  written. `teams.eliminated_at` and `teams.out_at_level` become vestigial and
  must never be written.
- The first team to clear the final level is `winner`; every later finisher is
  `finished`. `place` = 1 + the number of teams that finished earlier.
- `race` in the `team_view` payload becomes `{ level, found, teams }`: the level
  the team is hunting, how many teams already cleared it, and the total team
  count. It is progress information and never blocks anyone.
- A finished team may not submit again (`not_playing`).
- Migrations stay append-only: revision 2 adds new migrations that
  `create or replace` the two functions. Never edit a shipped migration, and
  re-apply `revoke`/`grant` after every `create or replace`.

---

## Task 17: Retire the slot helpers

**Files:**
- Modify: `src/lib/rounds.ts`, `src/lib/rounds.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `isUnlocked(level, cleared)` unchanged; `comparePlacement(a, b)`
  simplified to order `winner`/`finished` (by `finished_at`, earliest first)
  ahead of `playing` (by `cleared_level`, highest first). `slotsForLevel` and
  `setupWarning` are DELETED, along with the `Placed` fields they needed.
- `Placed` becomes `{ status: TeamStatus; cleared_level: number; finished_at: string | null }`.

- [ ] **Step 1: Rewrite the test file**

```ts
// src/lib/rounds.test.ts
import { isUnlocked, comparePlacement, type Placed } from './rounds'

describe('isUnlocked', () => {
  it('unlocks the first card and one past what is cleared', () => {
    expect(isUnlocked(1, 0)).toBe(true)
    expect(isUnlocked(2, 0)).toBe(false)
    expect(isUnlocked(3, 2)).toBe(true)
    expect(isUnlocked(4, 2)).toBe(false)
  })
})

describe('comparePlacement', () => {
  const playing: Placed = { status: 'playing', cleared_level: 1, finished_at: null }

  it('ranks finishers ahead of teams still playing', () => {
    const done: Placed = { status: 'finished', cleared_level: 5, finished_at: '2026-08-20T10:06:00Z' }
    expect(comparePlacement(done, playing)).toBeLessThan(0)
  })

  it('orders finishers by finish time, earliest first', () => {
    const first: Placed = { status: 'winner', cleared_level: 5, finished_at: '2026-08-20T10:05:00Z' }
    const second: Placed = { status: 'finished', cleared_level: 5, finished_at: '2026-08-20T10:06:00Z' }
    expect([second, first].sort(comparePlacement)).toEqual([first, second])
  })

  it('orders teams still playing by how far they have cleared', () => {
    const ahead: Placed = { status: 'playing', cleared_level: 3, finished_at: null }
    expect(comparePlacement(ahead, playing)).toBeLessThan(0)
  })

  it('treats winner and finished as the same rank, separated only by time', () => {
    const winner: Placed = { status: 'winner', cleared_level: 5, finished_at: '2026-08-20T10:05:00Z' }
    const later: Placed = { status: 'finished', cleared_level: 5, finished_at: '2026-08-20T10:07:00Z' }
    expect(comparePlacement(winner, later)).toBeLessThan(0)
    expect(comparePlacement(later, winner)).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/lib/rounds.test.ts`
Expected: FAIL — the old file still exports `slotsForLevel`/`setupWarning` and `Placed` still requires `out_at_level`/`eliminated_at`.

- [ ] **Step 3: Rewrite `src/lib/rounds.ts`**

```ts
export type TeamStatus = 'playing' | 'eliminated' | 'winner' | 'finished'

export type Placed = {
  status: TeamStatus
  cleared_level: number
  finished_at: string | null
}

export function isUnlocked(level: number, cleared: number): boolean {
  return level <= cleared + 1
}

/** Finishers first (earliest finish wins), then teams still hunting by progress. */
export function comparePlacement(a: Placed, b: Placed): number {
  const aDone = a.finished_at !== null
  const bDone = b.finished_at !== null
  if (aDone !== bDone) return aDone ? -1 : 1
  if (aDone && bDone) return (a.finished_at as string).localeCompare(b.finished_at as string)
  return b.cleared_level - a.cleared_level
}
```

`TeamStatus` keeps all four values because the database check constraint still
permits them; `eliminated` is simply never produced.

- [ ] **Step 4: Run and confirm green**

Run: `npx vitest run src/lib/rounds.test.ts` — expected PASS, 5 tests.
Then `npx tsc --noEmit` — expect errors ONLY where `slotsForLevel`/`setupWarning`
were used (`src/admin/Dashboard.tsx`), which Task 20 owns.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rounds.ts src/lib/rounds.test.ts
git commit -m "refactor: drop slot and setup-warning helpers, simplify placement"
```

---

## Task 18: Server rules without capacity

**Files:**
- Create: `supabase/migrations/20260820000009_no_elimination.sql`
- Modify: `tests/integration/submit-code.test.ts`, `tests/integration/team-view.test.ts`

**Interfaces:**
- Consumes: `normalize_code`, `card_opens`, the `stations`/`teams`/`game` schema.
- Produces: `team_view_json(uuid)` whose `race` is `{level, found, teams}` and whose `place` counts earlier finishers; `submit_code(text, text)` with no capacity check, returning `{ok:true, correct, reason?, view}` where `reason` is only ever `wrong` or `already_used`.

- [ ] **Step 1: Rewrite the integration tests**

Replace the elimination cases in `tests/integration/submit-code.test.ts` with
these (keep the existing wrong-code, already-used, cooldown, paused and
invalid-team cases exactly as they are — they are unaffected):

```ts
  it('lets every team clear the same level', async () => {
    const { a, b, c } = await threeTeamGame()
    for (const code of ['ALPHA1', 'BETA22', 'GAMMA3']) {
      expect(await submit(code, 'CODE1')).toMatchObject({ ok: true, correct: true })
    }
    for (const id of [a.id, b.id, c.id]) {
      expect((await teamRow(id))).toMatchObject({ current_position: 1, status: 'playing' })
    }
  })

  it('never eliminates anyone, however far apart the teams are', async () => {
    const { a, b, c } = await threeTeamGame()
    for (const code of ['CODE1', 'CODE2', 'CODE3']) {
      await submit('ALPHA1', code)
      await clearCooldown(service, a.id)
    }
    // A has claimed the treasure; B and C have not moved at all
    expect((await teamRow(a.id)).status).toBe('winner')
    for (const id of [b.id, c.id]) {
      expect((await teamRow(id))).toMatchObject({ status: 'playing', current_position: 0, out_at_level: null })
    }
    const { data } = await service.from('teams').select('status').eq('status', 'eliminated')
    expect(data).toEqual([])
  })

  it('crowns the first finisher and places later ones behind it', async () => {
    const { a, b, c } = await threeTeamGame()
    for (const team of [['ALPHA1', a.id], ['BETA22', b.id]] as const) {
      for (const code of ['CODE1', 'CODE2', 'CODE3']) {
        await submit(team[0], code)
        await clearCooldown(service, team[1])
      }
    }
    expect((await teamRow(a.id)).status).toBe('winner')
    expect((await teamRow(b.id)).status).toBe('finished')
    expect((await teamRow(c.id)).status).toBe('playing')

    const view = (await submit('GAMMA3', 'NOPE99')).view!
    expect(view.status).toBe('playing')
  })

  it('refuses further submits from a finished team', async () => {
    const { a } = await threeTeamGame()
    for (const code of ['CODE1', 'CODE2', 'CODE3']) {
      await submit('ALPHA1', code)
      await clearCooldown(service, a.id)
    }
    expect(await submit('ALPHA1', 'CODE1')).toMatchObject({ ok: false, error: 'not_playing' })
  })

  it('lets two teams clear the same level simultaneously', async () => {
    const { a, b } = await threeTeamGame()
    await submit('ALPHA1', 'CODE1')
    await submit('BETA22', 'CODE1')
    for (const id of [a.id, b.id]) await clearCooldown(service, id)

    const [first, second] = await Promise.all([submit('ALPHA1', 'CODE2'), submit('BETA22', 'CODE2')])
    expect(first).toMatchObject({ ok: true, correct: true })
    expect(second).toMatchObject({ ok: true, correct: true })
    for (const id of [a.id, b.id]) expect((await teamRow(id)).current_position).toBe(2)
  })
```

Delete the revision-1 cases: "eliminates the slowest team when a later race
fills", "refuses a submit from an eliminated team", "crowns the last team
standing without needing the final card", "lets a solo team play the whole
ladder" (superseded — a solo team is just an ordinary game now), "places later
finishers behind the winner when clues run short", and "serializes two teams
racing for the last slot".

In `tests/integration/team-view.test.ts`, replace the two `race` cases:

```ts
  it('reports the level being hunted with how many teams have cleared it', async () => {
    await seedStations(service, 3)
    await createTeam(service, 'Team 1', 'ALPHA1')
    await createTeam(service, 'Team 2', 'BETA22')
    await createTeam(service, 'Team 3', 'GAMMA3')
    await setGameStatus(service, 'live')

    expect((await view('ALPHA1')).race).toEqual({ level: 1, found: 0, teams: 3 })
  })

  it('counts teams already through the level being hunted', async () => {
    await seedStations(service, 3)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    const b = await createTeam(service, 'Team 2', 'BETA22')
    await createTeam(service, 'Team 3', 'GAMMA3')
    await setGameStatus(service, 'live')
    await service.from('teams').update({ current_position: 2 }).eq('id', a.id)
    await service.from('teams').update({ current_position: 1 }).eq('id', b.id)

    // B is hunting level 2; only A is through it
    expect((await view('BETA22')).race).toEqual({ level: 2, found: 1, teams: 3 })
  })
```

Also update the eliminated-team case in that file: instead of setting
`status:'eliminated'`, set the team `finished` with a `finished_at`, and assert
`race` is null and `place` is 1.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/integration/submit-code.test.ts tests/integration/team-view.test.ts --no-file-parallelism`
Expected: FAIL — `race` still returns `slots`/`taken`, and the current
`submit_code` still eliminates teams.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260820000009_no_elimination.sql
-- Revision 2: every level has a code for every team. No slots, no sweep, no
-- elimination. The first team to clear the final level wins; later finishers
-- are placed behind it by finish time.

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

  select status into v_status from game where id = 1;
  select count(*)::int into v_total from stations;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'level', s.sort_order,
        'unlocked', u.unlocked,
        'opened', co.team_id is not null,
        'clue', case when u.unlocked then s.clue_text else null end
      )
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

create or replace function public.submit_code(p_team_code text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams%rowtype;
  v_status text;
  v_code text := normalize_code(p_code);
  v_last timestamptz;
  v_wait int;
  v_total int;
  v_level int;
  v_expected text;
  v_first boolean;
begin
  select status into v_status from game where id = 1;

  -- Only this team's own row needs locking now: clearing a level is
  -- uncontended, so there is no global slot to serialize on.
  select * into v_team from teams where team_code = normalize_code(p_team_code) for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_team_code');
  end if;
  if v_status <> 'live' then
    return jsonb_build_object('ok', false, 'error', 'game_not_live');
  end if;
  if v_team.status <> 'playing' then
    return jsonb_build_object('ok', false, 'error', 'not_playing');
  end if;

  select max(created_at) into v_last from attempts where team_id = v_team.id;
  if v_last is not null and v_last > now() - interval '5 seconds' then
    v_wait := ceil(extract(epoch from (v_last + interval '5 seconds') - now()))::int;
    return jsonb_build_object(
      'ok', false, 'error', 'cooldown', 'retry_after_seconds', greatest(v_wait, 1)
    );
  end if;

  select count(*)::int into v_total from stations;
  v_level := v_team.current_position + 1;

  if exists (select 1 from stations where code = v_code and sort_order <= v_team.current_position) then
    insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'already_used');
    return jsonb_build_object(
      'ok', true, 'correct', false, 'reason', 'already_used', 'view', team_view_json(v_team.id)
    );
  end if;

  select code into v_expected from stations where sort_order = v_level;
  if v_expected is distinct from v_code then
    insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'wrong');
    return jsonb_build_object(
      'ok', true, 'correct', false, 'reason', 'wrong', 'view', team_view_json(v_team.id)
    );
  end if;

  insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'correct');

  if v_level >= v_total then
    select not exists (select 1 from teams where finished_at is not null) into v_first;
    update teams
    set current_position = v_level,
        finished_at = now(),
        status = case when v_first then 'winner' else 'finished' end
    where id = v_team.id;
  else
    update teams set current_position = v_level where id = v_team.id;
  end if;

  return jsonb_build_object('ok', true, 'correct', true, 'view', team_view_json(v_team.id));
end;
$$;

-- create or replace resets grants to include PUBLIC, so re-apply them.
revoke execute on function public.team_view_json(uuid) from public, anon;
grant execute on function public.submit_code(text, text) to anon, authenticated, service_role;
```

- [ ] **Step 4: Apply and verify**

Run: `npx supabase db reset` then
`npx vitest run tests/integration --no-file-parallelism`
Expected: the whole integration suite green.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260820000009_no_elimination.sql tests/integration
git commit -m "feat: every level open to every team, first finisher wins"
```

---

## Task 19: Player screens without elimination

**Files:**
- Modify: `src/lib/api.ts`, `src/player/usePlayerGame.ts`, `src/player/RaceStatus.tsx`, `src/player/CardGrid.tsx`, `src/player/PlayerApp.tsx`, `src/player/PlayerApp.test.tsx`
- Delete: `src/player/EliminatedScreen.tsx`

**Interfaces:**
- Consumes: the revision-2 `team_view` payload from Task 18.
- Produces: `Race = { level: number; found: number; teams: number }`; `SubmitResult`'s `reason` union narrowed to `'wrong' | 'already_used'`; `Feedback` without `too_late`; `<RaceStatus race={Race} />` rendering the found/teams count.

- [ ] **Step 1: Update the test file**

In `src/player/PlayerApp.test.tsx`: change the `view()` fixture's `race` to
`{ level: 2, found: 1, teams: 3 }`, replace the two race-count cases and the two
elimination cases with:

```tsx
  it('shows how many teams have found the code it is hunting', async () => {
    await loginAs(view())
    expect(await screen.findByText(/1 of 3 teams found this code/i)).toBeInTheDocument()
  })

  it('shows the winner screen for the first finisher', async () => {
    await loginAs(view({ status: 'winner', cleared: 3, race: null, place: 1 }))
    expect(await screen.findByText(/treasure found/i)).toBeInTheDocument()
  })

  it('shows the placing for a later finisher', async () => {
    await loginAs(view({ status: 'finished', cleared: 3, race: null, place: 2 }))
    expect(await screen.findByText(/2nd/i)).toBeInTheDocument()
  })
```

Delete: "warns when only one slot remains", "shows the too-late message when the
slots filled first", and "switches to the eliminated screen with the level
reached".

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/player/PlayerApp.test.tsx`
Expected: FAIL — the HUD still renders slot copy.

- [ ] **Step 3: Update the types**

In `src/lib/api.ts`:

```ts
export type Race = { level: number; found: number; teams: number }
```

and narrow the submit reason union:

```ts
  | { ok: true; correct: false; reason: 'wrong' | 'already_used'; view: TeamView }
```

- [ ] **Step 4: Update `usePlayerGame`**

Narrow `Feedback` to drop `too_late`:

```ts
export type Feedback =
  | { kind: 'wrong' | 'already_used' | 'correct' }
  | { kind: 'cooldown'; seconds: number }
  | { kind: 'error'; message: string }
```

Everything else in the hook is unchanged.

- [ ] **Step 5: Rewrite `RaceStatus`**

```tsx
import type { Race } from '../lib/api'

export default function RaceStatus({ race }: { race: Race }) {
  return (
    <div className="race-status" role="status">
      <span className="race-count">
        {race.found} of {race.teams} teams found this code
      </span>
    </div>
  )
}
```

No urgent state and no `race-urgent` class — nothing is at stake in a count any
more, so styling it as an alarm would lie to the player.

- [ ] **Step 6: Update `CardGrid` and `PlayerApp`**

In `CardGrid.tsx`, delete the `too_late` branch of the feedback switch. In
`PlayerApp.tsx`, delete the `EliminatedScreen` import and its
`view.status === 'eliminated'` branch, so the remaining routing is: no view →
login; `winner`/`finished` → FinishedScreen; game not live → WaitingScreen;
otherwise → CardGrid. Then `git rm src/player/EliminatedScreen.tsx`.

- [ ] **Step 7: Verify**

Run: `npx vitest run src` — expect green.
Then `npx tsc --noEmit` — expect errors ONLY in `src/admin/Dashboard.tsx`
(Task 20 owns it).

- [ ] **Step 8: Commit**

```bash
git add src/lib/api.ts src/player
git commit -m "feat: player screens for a straight race, no elimination"
```

---

## Task 20: Dashboard without elimination, and docs

**Files:**
- Modify: `src/admin/Dashboard.tsx`, `src/admin/Dashboard.test.tsx`, `src/admin/TeamsPanel.tsx`, `README.md`

**Interfaces:**
- Consumes: `comparePlacement` (Task 17), `admin_monitor`.
- Produces: no new exports.

- [ ] **Step 1: Update the dashboard test**

Replace the slots/mismatch cases in `src/admin/Dashboard.test.tsx` with:

```tsx
  it('summarises how many teams have finished', () => {
    mount([
      row({ name: 'Champs', status: 'winner', cleared_level: 3, finished_at: '2026-08-20T10:00:00Z' }),
      row({ name: 'Chasers', cleared_level: 1, started: true }),
    ])
    expect(screen.getByText(/1 of 2 teams finished/i)).toBeInTheDocument()
  })

  it('shows where the pack has reached', () => {
    mount([
      row({ name: 'A', cleared_level: 2, started: true }),
      row({ name: 'B', cleared_level: 1, started: true }),
    ])
    expect(screen.getByText(/clue 2/i)).toBeInTheDocument()
  })

  it('marks a later finisher with its placing', () => {
    mount([row({ name: 'Second', status: 'finished', cleared_level: 3, finished_at: '2026-08-20T10:09:00Z' })])
    expect(screen.getByText('Second').closest('tr')).toHaveTextContent(/finished/i)
  })
```

Delete the cases asserting "teams alive", the mismatch warning, and `Out at N`.
Keep the started/not-started case, the opened/cleared case and the
winner-highlight case as they are.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/admin/Dashboard.test.tsx`
Expected: FAIL — the component still imports the deleted `slotsForLevel` and
`setupWarning`.

- [ ] **Step 3: Update `Dashboard.tsx`**

- Drop the `slotsForLevel` and `setupWarning` imports and the setup-warning
  paragraph entirely.
- Headline becomes: game status, `${finished} of ${rows.length} teams finished`,
  and — when at least one team is still playing — `clue ${packLevel}`, where
  `packLevel = Math.min(...playing.map(r => r.cleared_level)) + 1`, guarded for
  the empty case exactly as the current code guards it.
- State column: `Winner` for `winner`, `Finished` for `finished`, `Playing`
  otherwise. Remove the `Out at <level>` branch.
- Keep `row-winner`, `row-idle` and the `comparePlacement` sort. Drop `row-out`.

In `src/admin/TeamsPanel.tsx`, drop the `— out at N` text from the progress
column for the same reason; keep the trophy for winner/finished.

- [ ] **Step 4: Update `README.md`**

Rewrite the rules section for revision 2: the shared ladder, a code for every
team at every level, first finisher wins and later finishers are placed, no
elimination, the admin flow (generate teams → one station per level, contiguous
→ print → start), that scratching is recorded server-side, and the local
commands (`npx supabase start`, `npx supabase db reset`, `npm run test:unit`,
`npm run test:integration`).

- [ ] **Step 5: Verify everything**

```bash
npx tsc --noEmit
npx vitest run src
npx supabase db reset && npx vitest run tests/integration --no-file-parallelism
npm run build
```

All four must pass. This is the revision-2 equivalent of the original Task 16
gate; Task 16's own step 3 (playing a game by hand) still applies but with the
revision-2 expectation — no team is ever eliminated, and a second finisher is
placed 2nd rather than knocked out.

- [ ] **Step 6: Commit**

```bash
git add src/admin README.md
git commit -m "feat: dashboard and docs for a straight race"
```
