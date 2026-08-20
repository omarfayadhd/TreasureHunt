# Elimination rounds, scratch cards, arcade skin — design

Date: 2026-08-20
Status: approved, ready for planning
Supersedes the race-to-finish flow in `2026-08-17-treasure-hunt-design.md`

## Purpose

Three changes, one release:

1. **Elimination rounds.** All teams chase the same ladder of clues. Every race
   after the first has one fewer slot than there are teams left, so the team
   that misses the last slot is out. The game ends on a last team standing.
2. **Scratch cards.** Players get a Paytm-style grid of foil cards instead of
   one clue at a time, plus a live anonymous count of slots left in the race.
3. **Arcade skin.** The whole app is reskinned as an 8-bit arcade game —
   Pac-Man neon on black, pixel chrome, hard-edged everything.

Plus one admin addition: set the number of teams as a count and have them
generated, so a 3-team game is as easy to run as a 12-team one.

## Game rules

Let `M` = number of clue levels (one station per level) and `N` = number of
teams. `M` and `N` are independent; any combination plays.

- There are `M` cards. Card 1 is unlocked; cards 2…M start locked.
- Clue `L` leads to the location where code `L` is posted.
- Submitting code `L` clears level `L` and unlocks card `L+1`.
- Clearing the last level `M` claims the treasure.

**Slots.** Evaluated live at the moment of each clear, where `alive` is the
number of teams **not eliminated** — winners and finishers still hold the slot
they took — including the submitting team:

```
slots(level 1) = alive          -- the opening race eliminates nobody
slots(level L) = alive - 1      -- every later race drops the slowest team
```

**Elimination rule.** When the team that just cleared level `L` takes the last
slot, every team still below level `L` is eliminated in the same transaction,
with `out_at_level = L`.

**Two end conditions.**

- *Last standing* — when exactly one `playing` team remains and nobody has
  finished, it wins immediately (`status = 'winner'`), even with cards left
  unopened. Skipped when the game started with a single team, so a solo practice
  run plays the ladder to the end. The nobody-finished guard matters when levels
  are scarcer than teams: there, teams leave `playing` by claiming the treasure,
  and the stragglers still deserve their shot at it.
- *Treasure claimed* — clearing level `M` sets `finished_at` and
  `status = 'winner'` for the first finisher, `'finished'` for any later one.

For `N` teams and `M = N` levels this produces exactly the intended shape:

| Race (N=5, M=5) | Slots | Alive after |
| --------------- | ----- | ----------- |
| 1               | 5     | 5 — nobody out |
| 2               | 4     | 4           |
| 3               | 3     | 3           |
| 4               | 2     | 2           |
| 5 (treasure)    | 1     | 1 winner    |

Mismatched counts still play, and admin is warned rather than blocked:

- **Fewer levels than teams** (`M < N-1`): the treasure race has `alive - 1`
  slots, so several teams claim the treasure and are placed by finish time.
- **More levels than teams** (`M > N-1`): last-standing ends the game early and
  the remaining cards go unused.

`M = N` is the recommended setup and the admin dashboard says so.

## Data model

### Removed

- `route_stops` and the route-generation RPC. Per-team shuffled routes are
  incompatible with racing for a shared code; all teams share one ladder.
- `stations.is_final` and its `stations_single_final` index — the final level is
  simply the highest `sort_order`.

### Changed

- `stations.sort_order` **is** the level: `not null`, `unique`, `>= 1`.
- `stations.code` constrained to `^[A-Z0-9]{3,12}$` — no spaces, no punctuation.
- `teams.current_position` keeps its name, now meaning "levels cleared"
  (0 = only card 1 available).
- `teams` gains:
  - `status text not null default 'playing' check (status in ('playing','eliminated','winner','finished'))`
  - `eliminated_at timestamptz`
  - `out_at_level int`
- `game` gains `initial_team_count int`, snapshotted by `start_game` — used for
  display and to disable last-standing in a solo game, not for slot math.
- `attempts.result` gains `'too_late'`.
- `normalize_code(text)` strips everything outside `[A-Za-z0-9]` before
  upper-casing, so `mango 77!` and `MANGO77` are the same code.

### Added

```sql
create table public.card_opens (
  team_id uuid not null references public.teams (id) on delete cascade,
  level int not null,
  opened_at timestamptz not null default now(),
  primary key (team_id, level)
);
```

One row per scratch — the source of truth for "who has started" and "how far
have they opened", independent of how far they have *cleared*.

Realtime publication: `teams`, `attempts`, `card_opens`, `game`.

## Server logic

All rules live in `security definer` RPCs; the anon client never writes game
tables directly. RLS stays deny-by-default for anon on every table.

### `team_view(p_team_code) -> jsonb`

Read model for the player app, and the payload returned by every mutation.

```jsonc
{
  "ok": true,
  "team_name": "Team 2",
  "game_status": "live",
  "status": "playing",          // playing | eliminated | winner | finished
  "cleared": 2,
  "total": 5,                   // = M, the number of cards
  "out_at_level": null,
  "place": null,                // see Placement
  "race": { "level": 3, "slots": 3, "taken": 1 },   // null unless playing+live
  "cards": [
    { "level": 1, "unlocked": true,  "opened": true,  "clue": "…" },
    { "level": 2, "unlocked": true,  "opened": true,  "clue": "…" },
    { "level": 3, "unlocked": true,  "opened": false, "clue": "…" },
    { "level": 4, "unlocked": false, "opened": false, "clue": null },
    { "level": 5, "unlocked": false, "opened": false, "clue": null }
  ]
}
```

`clue` is non-null **only for unlocked levels**, so locked clue text never
reaches the client and the grid cannot be read out of the network tab. Card `L`
is unlocked when `cleared >= L - 1` and the game is live.

**Placement.** `place = 1 + count(teams that outlasted this one)`: winners and
finishers outlast everyone, ordered by `finished_at`; among eliminated teams a
higher `out_at_level` outlasts a lower one, and at equal level an earlier
`eliminated_at` places worse. Teams swept in one transaction share a place.
Display only — no rule depends on it.

### `submit_code(p_team_code, p_code) -> jsonb`

1. `select … for update` on the single `game` row — serializes all submits, so
   two teams contending for the last slot resolve deterministically.
2. Lock the team row. Reject unknown team code, `game_status <> 'live'`,
   `status <> 'playing'`, and a submit within 5s of the team's last attempt
   (`cooldown` with `retry_after_seconds`).
3. Let `L = cleared + 1`. A code the team already used → `already_used`; a code
   that isn't level `L`'s → `wrong`. Both recorded in `attempts`.
4. If `count(cleared >= L) >= slots(L)` → record `too_late`, eliminate the team
   with `out_at_level = L`, return `too_late`. (Reachable only if a sweep and
   this submit interleave.)
5. Otherwise record `correct` and set `current_position = L`. If `L = M`, set
   `finished_at` and `status` (`winner` for the first finisher, else `finished`).
6. If that clear filled the last slot, sweep: `status = 'eliminated'`,
   `eliminated_at = now()`, `out_at_level = L` for every `playing` team with
   `current_position < L`.
7. Apply last-standing: if exactly one `playing` team remains,
   `initial_team_count > 1`, and no team has finished, make it the winner.
8. Return the fresh `team_view` payload plus `{ "correct": true }`.

### `open_card(p_team_code, p_level) -> jsonb`

Idempotent insert into `card_opens`; a repeat call for the same level is a no-op
success. Rejects unknown team codes, levels the team hasn't unlocked, and any
call while the game isn't live. Returns the clue text, so revealing always goes
through the server and a locked clue can't be scratched open. Eliminated teams
may still re-open cards they already unlocked.

### `generate_teams(p_count) -> jsonb` (new)

Admin-only. Creates teams up to `p_count`: names `Team 1…Team N`, codes from the
existing generator, constrained to `^[A-Z0-9]{3,12}$` and checked unique.
Refuses while the game is live. Idempotent in the sense that it tops up to the
requested count rather than duplicating existing teams; lowering the count never
deletes anyone (deletion stays an explicit per-team action).

### `start_game` / `reset_game`

`start_game` snapshots `initial_team_count` and requires `sort_order` to cover
`1…M` with no gaps (`level_gap`). It no longer requires `M = N`; count mismatch
is a dashboard warning. `reset_game` clears `card_opens`, `attempts`, team
status/progress and `initial_team_count`. Adding or deleting teams and stations
stays blocked while live.

### `admin_monitor` view

One row per team, `security_invoker`, admin-only via RLS:

```
name, team_code, status, started (card 1 opened?),
cleared_level, max_opened_level, out_at_level, last_solve_at, wrong_count
```

## Player UI

`usePlayerGame` holds the `team_view` payload and refetches on any realtime
event touching `teams`, `game`, or the team's `card_opens`.

- **LoginScreen** — team code entry (existing floating-label field, reskinned).
- **CardGridScreen** (new, replaces `GameScreen`)
  - `RaceStatus` HUD: `3 OF 4 CODES FOUND — 1 SLOT LEFT`, live, anonymous.
  - `ScratchCard` grid, one per level: locked (padlock sprite + level number),
    foil (unscratched), or revealed clue.
  - `CodeEntry` for the current level, keeping the wrong-code shake, the
    already-used nudge and the cooldown countdown.
- **EliminatedScreen** (new) — "GAME OVER — the other teams found all the
  codes", the level reached, and final placing.
- **FinishedScreen** — treasure claimed; shows placing when several finish.
- **WaitingScreen** — setup / paused / ended.

### ScratchCard component

Canvas foil over the clue. Pointer and touch drag erase with `destination-out`;
scratched fraction is sampled from the alpha channel of a downscaled copy every
few strokes, and crossing ~55% clears the rest. The first stroke fires
`open_card`, so the reveal survives refresh (`opened: true` renders bare text,
no canvas). Under `prefers-reduced-motion` the foil becomes a tap-to-reveal
button, and the clue is always in the accessibility tree regardless of scratch
state.

## Admin UI

New single **Dashboard** page, the admin landing page, replacing Live Board:

- Headline: game status, current race level, slots taken/total, teams alive.
- Setup warning line comparing `M` and `N` ("5 teams, 3 clues — three teams will
  reach the treasure together"), green when `M = N`.
- Live table from `admin_monitor` sorted by progress then last solve: team,
  started?, cards opened, level cleared, state (`playing` / `out at 3` /
  `winner`), last solve, wrong attempts. Eliminated rows muted, winner
  highlighted, not-started flagged.

**Teams panel** gains a **Number of teams** field: type a count, press
Generate, get `Team 1…Team N` with codes ready to print. The existing
add/rename/delete list stays for renaming afterwards.

**Stations panel** switches "sort order" to an explicit **Level** column,
enforces contiguous levels, and validates codes against `^[A-Z0-9]{3,12}$`.

Control and Print stay, Print gaining the level number on each station sheet.

## Arcade skin

Replaces the warm parchment palette app-wide. The Figtree body font, the
floating-label field and the chest mark stay in concept, redrawn in this style.

- **Palette** — near-black cabinet ground (`#0b0b12`), maze blue (`#2121de`),
  neon yellow (`#ffd400`, primary/coin), cyan (`#33ffff`), magenta
  (`#ff5edb`), Pac-Man ghost red (`#ff3b30`) for danger, phosphor green
  (`#4ade80`) for cleared. High contrast throughout; every text/background pair
  checked against WCAG AA.
- **Type** — `Press Start 2P` for logo, headings, buttons, HUD counters, card
  labels and table headers, at generous letter-spacing and never below 10px.
  Figtree stays for clue paragraphs and admin table text, which are the only
  places long-form reading happens.
- **Form** — zero border-radius, 3–4px solid borders, offset hard block shadows
  (`4px 4px 0`), no blur or backdrop filters, `image-rendering: pixelated` on
  sprites, stepped `steps()` animations rather than eased ones.
- **Sprites** (inline SVG on a pixel grid, no bitmap assets): treasure chest
  redrawn 16×16-style, padlock for locked cards, coin for cleared levels, ghost
  for elimination, flag for the final level.
- **Motion** — a coin-flip reveal on unlock, a stepped blink on the active card,
  a ghost-wobble on the eliminated screen, a slow CRT scanline overlay at low
  opacity. All gated behind `prefers-reduced-motion`.
- **Print stays light** — the print stylesheet forces white paper, black text
  and drops the skin, so station and team sheets don't eat a toner cartridge.

## Migrations

Additive, in order, as `supabase/migrations/20260820000001…6`:

1. Schema: team status columns, `card_opens`, `game.initial_team_count`,
   `attempts.result` check, station level constraints, drop `route_stops`,
   `stations.is_final` and `stations_single_final`, extend the realtime
   publication.
2. `normalize_code` rewrite.
3. `team_view` (replaces `team_login`).
4. `submit_code` rewrite with slots, sweep and last-standing.
5. `open_card` and `generate_teams`.
6. `start_game` / `reset_game` guards, `admin_monitor`, RLS for `card_opens`,
   and dropping the route-generation RPC.

## Testing

- **Unit, pure** — `slots(level, alive)`, card lock/open derivation, the sweep
  predicate, placement ordering, and the `M`/`N` warning copy, as plain
  functions in `src/lib/`.
- **Integration (Supabase)** — two teams contending for the last slot in
  parallel; the sweep; `too_late`; last-standing including the solo-game
  exception; several finishers when `M < N-1`; `open_card` idempotency and its
  locked-level rejection; locked clues absent from `team_view`;
  `generate_teams` topping up and refusing while live; `level_gap`;
  `reset_game`; RLS denying anon reads of `stations` and `card_opens`.
- **Component** — card grid lock/foil/revealed states, race HUD copy, eliminated
  screen, scratch reveal firing `open_card` exactly once, team-count generator
  form.
- Existing tests referencing `route_stops`, route generation or the single-clue
  `GameScreen` are rewritten, not deleted.

## Out of scope

Team chat, photo proof, hints and penalties, multiple concurrent games,
per-team custom ladders, admin-confirmed manual cuts, and sound effects.
