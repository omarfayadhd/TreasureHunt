# Treasure Hunt — Design Spec

**Date:** 2026-08-17
**Status:** Approved design, pre-implementation
**Stack:** React + Vite SPA · Supabase (Postgres, Auth, Realtime) · Vercel/Netlify static hosting

## 1. Overview

A web app for an office treasure hunt competition. Teams log in with a secret
team code, see a clue on screen, physically find the code posted at the clued
location, enter it, and unlock the next clue — repeating until the final
treasure code. First team to enter the final code wins. An admin dashboard
manages teams, stations, and game state, and shows a live progress board.

One hunt at a time; progress is resettable so the same setup can be re-run.

## 2. Game rules

- A **station** is a physical location with a **clue** (the riddle that leads
  *to* it) and a **code** (posted *at* it). Exactly one station is the
  **final treasure** station.
- Every team visits **all stations**, in a **per-team shuffled order**, with
  the treasure station always last. Starting stations are spread across teams
  so groups don't cluster.
- On login (game live), a team immediately sees the first clue of their route.
  No physical starter code is handed out.
- Entering the correct code for their **next** station advances the team one
  position and reveals the following clue. Entering the final station's code
  finishes the hunt for that team and records their finishing rank.
- Code comparison is case-insensitive and whitespace-trimmed.
- Wrong codes get a **generic** "not the right code" message — including codes
  that belong to other stations — so codes can't be probed or reused out of
  order. Exception: re-entering a code the team has **already solved** returns
  a friendly "already used" message.
- A team may submit at most one code every **5 seconds** (server-enforced) to
  prevent brute-forcing.
- Winner = lowest `finished_at`. Rank is computed from finish timestamps.

## 3. Data model

All tables in the `public` schema of a Supabase Postgres database. Schema is
managed via versioned migrations in `supabase/migrations/`.

### `game`
Single-row table (enforced by a constant primary key).

| column | type | notes |
|---|---|---|
| id | int PK, always 1 | `CHECK (id = 1)` |
| status | text | `'setup' \| 'live' \| 'paused' \| 'ended'`, default `'setup'` |
| started_at | timestamptz null | set when first moved to `live` |
| ended_at | timestamptz null | set when moved to `ended` |

Transitions: `setup → live`, `live ↔ paused`, `live/paused → ended`.
`reset_progress()` returns the game to `setup`.

### `stations`

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| name | text | admin-facing label, e.g. "Kitchen fridge" |
| clue_text | text | the riddle that leads to this station |
| code | text unique | normalized (upper-cased, trimmed) on write |
| is_final | boolean | exactly one final station required to start; enforced by partial unique index |
| sort_order | int | admin display order only; play order comes from routes |
| created_at | timestamptz | |

### `teams`

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| name | text unique | |
| team_code | text unique | secret; auto-generated, admin can regenerate |
| current_position | int default 0 | number of stations solved |
| finished_at | timestamptz null | set on final-code entry |
| created_at | timestamptz | |

### `route_stops`

| column | type | notes |
|---|---|---|
| team_id | uuid FK → teams (cascade delete) | |
| position | int (1-based) | |
| station_id | uuid FK → stations (cascade delete) | |

Constraints: PK `(team_id, position)`, unique `(team_id, station_id)`.
A team's **next station** is the stop at `position = current_position + 1`.

### `attempts`

| column | type | notes |
|---|---|---|
| id | bigint PK | |
| team_id | uuid FK → teams (cascade delete) | |
| submitted_code | text | as normalized |
| result | text | `'correct' \| 'wrong' \| 'already_used'` |
| created_at | timestamptz | |

Powers the 5-second cooldown, the admin live feed, and post-game stats.
Cleared by `reset_progress()`.

## 4. Security model

**Players are never authenticated.** The `anon` role has **no direct access
to any table** (RLS enabled everywhere, no `anon` policies). All player
interaction goes through two `SECURITY DEFINER` RPCs keyed by the secret team
code. The team code is stored in the browser's localStorage for session
restore.

**Admin** signs in with Supabase Auth email/password. Public sign-ups are
disabled in the Supabase project settings; the only account(s) created are
admins. RLS grants the `authenticated` role full select/insert/update/delete
on all tables. Admin-only RPCs check `auth.uid() IS NOT NULL`.

Anti-cheat properties:

- Clue texts and codes never reach the client until earned — validation and
  clue release happen inside Postgres.
- Generic wrong-code responses prevent probing which codes exist.
- Server-side cooldown prevents brute force.

## 5. RPC contracts

All functions return `jsonb`. Player functions take the team code and are
callable by `anon`; admin functions require an authenticated caller.

### `team_login(p_team_code text)` — player

Validates the team code and returns the team's full current view. Also used
to restore sessions and to poll for admin overrides.

```jsonc
// failure
{ "ok": false, "error": "invalid_team_code" }
// success
{
  "ok": true,
  "team_name": "The Mongooses",
  "game_status": "live",          // setup | live | paused | ended
  "position": 2,                   // stations solved
  "total": 8,                      // route length
  "clue": "Where the coffee...",  // next clue; null unless status = live and not finished
  "finished": false,
  "rank": null                     // int when finished
}
```

### `submit_code(p_team_code text, p_code text)` — player

Normalizes the code, enforces game state and cooldown, logs the attempt,
advances on success.

```jsonc
// failures (no attempt is logged for any failure response)
{ "ok": false, "error": "invalid_team_code" }
{ "ok": false, "error": "game_not_live" }
{ "ok": false, "error": "cooldown", "retry_after_seconds": 3 }
{ "ok": false, "error": "already_finished" }
// wrong code (attempt logged as 'wrong')
{ "ok": true, "correct": false, "reason": "wrong" }
// already-solved station on their route (logged as 'already_used')
{ "ok": true, "correct": false, "reason": "already_used" }
// correct, more clues remain
{ "ok": true, "correct": true, "finished": false, "position": 3, "total": 8, "clue": "..." }
// correct final code
{ "ok": true, "correct": true, "finished": true, "position": 8, "total": 8, "rank": 2 }
```

Concurrency: the team row is locked (`SELECT ... FOR UPDATE`) during
validation so double-submits can't double-advance.

### `generate_routes()` — admin

- In `setup`: deletes all `route_stops` and regenerates routes for every team.
- In `live`/`paused`: only creates routes for teams that lack one (late-added
  teams), never touching existing routes.
- Algorithm: shuffle non-final stations independently per team; assign
  starting stations round-robin from a shuffled list so no two teams share a
  start while team count ≤ non-final station count; append the final station.
- Errors if there is not exactly one final station or zero non-final stations.

### `set_team_position(p_team_id uuid, p_position int)` — admin

Manual advance/rollback. Clamps to `[0, route length]`; sets `finished_at`
when moved to the end, clears it when moved back. Keeps rank consistency
(finish time = time of override).

### `start_game()` / `pause_game()` / `resume_game()` / `end_game()` — admin

State transitions per §3. `start_game()` validates: ≥1 team, exactly one
final station, and every team has a complete route.

### `reset_progress()` — admin

Sets every team's `current_position = 0` and `finished_at = NULL`, deletes
all `attempts`, sets game back to `setup` (clearing `started_at`/`ended_at`).
Teams, stations, and routes are kept.

## 6. Realtime & polling

- **Admin live board:** Supabase Realtime (`postgres_changes`) subscriptions
  on `teams` (progress/finish updates) and `attempts` (live guess feed),
  available to the authenticated admin via RLS. Tables added to the
  `supabase_realtime` publication.
- **Player app:** no realtime. Re-fetches `team_login` after every submit, on
  window focus, and on a 30-second interval — covering admin overrides and
  game-state changes.

## 7. Player app (route `/`, mobile-first)

Screens (single `PlayerApp` state machine):

1. **Team code entry** — one input; on success stores the code in
   localStorage and shows the team name. Auto-restores on revisit.
2. **Waiting** — game in `setup` ("Hold tight — the hunt hasn't started") or
   `paused` or `ended`.
3. **Game screen** — progress indicator ("Clue 3 of 8" with step dots), clue
   card, code input with submit. Wrong → shake animation + message
   (distinct copy for "already used"); cooldown → countdown on the button;
   correct → celebratory transition to the next clue.
4. **Treasure found** — 🏆 screen with finishing rank ("You finished 2nd!").

Playful, high-contrast, thumb-friendly design; works on any phone browser.

## 8. Admin dashboard (route `/admin`, desktop-first)

Email/password login gate, then four tabs:

- **Live board** — teams ranked by (finished rank, then position desc, then
  last correct attempt asc): team name, progress bar, current/next station,
  last solve time, finish rank. Real-time. Side feed of recent attempts
  (wrong guesses included — fun to watch).
- **Teams** — CRUD; shows team codes with copy + regenerate; per-team
  advance/rollback via `set_team_position`.
- **Stations** — CRUD list in `sort_order`: name, clue text, code
  (auto-generate memorable `WORD-##` codes with manual override), mark
  exactly one as final. Warns when editing while game is live.
- **Game control** — game status controls (Start/Pause/Resume/End) with
  validation errors surfaced; **Generate routes** with a per-team route
  preview table; **Reset progress** behind a type-to-confirm dialog; link to
  the **print page**.

**Print page** (`/admin/print`) — print-friendly sheets: one card per station
(code in large type, station name small, for posting at locations) and one
slip per team (team name + team code, for handing out).

## 9. Project structure

```
TreasureHunt/
  supabase/
    migrations/           # schema + RPCs + RLS + seeds for local dev
    config.toml
  src/
    main.tsx, App.tsx     # router: / (player), /admin
    lib/supabaseClient.ts
    lib/api.ts            # typed wrappers around the RPCs
    player/               # LoginScreen, GameScreen, ClueCard, CodeInput,
                          # FinishedScreen, WaitingScreen, usePlayerGame hook
    admin/                # AdminLogin, LiveBoard, TeamsPanel, StationsPanel,
                          # GameControl, PrintPage, useRealtimeBoard hook
  tests/
    integration/          # RPC tests against local Supabase
  .env.example            # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
```

## 10. Testing

- **Integration (primary):** Vitest suites running against `supabase start`
  (local Docker stack): service-role client seeds fixtures; anon client
  exercises `team_login`/`submit_code` (correct, wrong, already-used, final,
  cooldown, game-state gating, invalid team); authenticated client exercises
  admin RPCs (route-generation invariants: all stations once each, final
  last, distinct starts; start-game validation; reset; position override).
- **Component:** React Testing Library for the player state machine (login →
  clue → correct/wrong/cooldown → finished) with the api layer mocked.
- Development follows TDD: failing test first, then implementation.

## 11. Deployment

- **Backend:** hosted Supabase project (free tier sufficient). Migrations
  pushed via `supabase db push` (CLI linked to the project). Public sign-ups
  disabled; one admin user created in the dashboard. Realtime publication
  configured by migration.
- **Frontend:** `vite build` static output deployed to Vercel or Netlify
  with the two `VITE_*` env vars. SPA fallback rewrite for `/admin` routes.

## 12. Out of scope (deliberately)

- Multiple concurrent hunts / event history
- Individual player accounts or per-person tracking
- Points/penalty scoring (winner is first-to-finish)
- Photo challenges, uploads, maps/GPS
- Push notifications
- Internationalization
