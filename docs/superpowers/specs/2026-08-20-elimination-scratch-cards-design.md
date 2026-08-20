# Race to the treasure, scratch cards, arcade skin — design

Date: 2026-08-20 (revision 2 — elimination removed)
Status: approved, in implementation
Supersedes the race-to-finish flow in `2026-08-17-treasure-hunt-design.md`.
The filename keeps the word "elimination" for link stability; revision 2 has
none.

## Purpose

Three changes, one release:

1. **A straight race.** All teams chase the same ladder of clues. Every level
   has a code for every team, so nobody is ever blocked or knocked out. The
   first team to claim the treasure wins; the rest keep playing for a placing.
2. **Scratch cards.** Players get a Paytm-style grid of foil cards instead of
   one clue at a time, plus a live anonymous count of how many teams have
   already found the code they are hunting.
3. **Arcade skin.** The whole app is reskinned as an 8-bit arcade game —
   Pac-Man neon on black, pixel chrome, hard-edged everything.

**Revision 2 note.** An earlier revision of this spec eliminated the slowest
team each round (slots = alive - 1). That is removed: there are no slots, no
sweep, and no eliminated state. What survives from it is the shared ladder, the
scratch cards, the live rival counter, and the admin monitor.

Plus one admin addition: set the number of teams as a count and have them
generated, so a 3-team game is as easy to run as a 12-team one.

## Game rules

Let `M` = number of clue levels (one station per level) and `N` = number of
teams. They are independent; any combination plays.

- There are `M` cards. Card 1 is unlocked; cards 2…M start locked.
- Clue `L` leads to the location where code `L` is posted.
- Submitting code `L` clears level `L` and unlocks card `L+1`.
- Clearing the last level `M` claims the treasure.

**Every level has a code for every team.** A code is not consumed by being
used: any number of teams may clear the same level, in any order, at any time.
No team is ever eliminated, blocked, or timed out of a level.

**Winning.** The first team to clear level `M` becomes the `winner`. Every
later finisher becomes `finished` and is placed by finish time (2nd, 3rd, …).
Teams that have not finished keep playing — a win by one team never ends
another team's hunt. The game stops only when the admin ends it.

For 5 teams and 6 levels, every level offers 5 codes' worth of capacity, all
five teams can reach the treasure, and the ordering is purely who got there
first.

**What a stuck team looks like.** Since nothing removes a team, a team that
cannot find a code simply stays on its level. The admin dashboard surfaces this
as a stale "last code" time and a rising miss count, so the game master can go
help rather than the game deciding for them.

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
    — revision 2 uses only `playing`, `winner` and `finished`. `eliminated`
    stays permitted by the constraint but is never written; dropping it would
    mean rewriting a shipped migration for no behavioural gain.
  - `eliminated_at timestamptz` — **vestigial**, never written in revision 2.
  - `out_at_level int` — **vestigial**, never written in revision 2.
- `game` gains `initial_team_count int`, snapshotted by `start_game` for display
  only. No rule depends on it in revision 2.
- `attempts.result` permits `'too_late'`, which revision 2 never records — the
  condition it described (arriving after the slots filled) no longer exists.
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

Realtime publication: `teams`, `attempts`, `card_opens`, `game`. Note that
`postgres_changes` is authorized per subscriber against RLS, so only the
`authenticated` admin session actually receives these events — anon players
receive none, and RLS is deliberately not opened up for them because `teams`
holds every team's `team_code`.

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
  "status": "playing",          // playing | winner | finished
  "cleared": 2,
  "total": 5,                   // = M, the number of cards
  "out_at_level": null,         // vestigial, always null
  "place": null,                // see Placement
  "race": { "level": 3, "found": 1, "teams": 5 },   // null unless playing+live
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

`race` describes the level the team is currently hunting: `found` counts the
teams that have already cleared it, `teams` is the total number of teams. It is
progress information only — a full `found` never blocks anyone.

**Placement.** `place = 1 + count(teams that finished before this one)`, set
once a team finishes: the first finisher is 1st, the next 2nd, and so on by
`finished_at`. A team still playing has `place: null`. Display only.

### `submit_code(p_team_code, p_code) -> jsonb`

1. Lock the team row. Reject unknown team code, `game_status <> 'live'`,
   `status <> 'playing'` (a finished team cannot submit again), and a submit
   within 5s of the team's last attempt (`cooldown` with `retry_after_seconds`).
2. Let `L = cleared + 1`. A code the team already used → `already_used`; a code
   that isn't level `L`'s → `wrong`. Both recorded in `attempts`.
3. Otherwise record `correct` and set `current_position = L`. There is no
   capacity check: any number of teams may clear the same level.
4. If `L = M`, set `finished_at` and `status` — `winner` when no team has
   finished yet, otherwise `finished`.
5. Return the fresh `team_view` payload plus `{ "correct": true }`.

No sweep, no `too_late`, no last-standing rule. Concurrency is therefore
uncontended: two teams clearing the same level simultaneously both succeed, so
the global `for update` lock on the `game` row that revision 1 needed is gone —
the per-team row lock is enough to serialize one team's own double-submits.

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
`1…M` with no gaps (`level_gap`). Team count and level count are unrelated in
revision 2, so there is no mismatch to warn about. `reset_game` clears `card_opens`, `attempts`, team
status/progress and `initial_team_count`. Adding or deleting teams and stations
stays blocked while live.

### `admin_monitor` view

One row per team, `security_invoker`, admin-only via RLS:

```
name, team_code, status, started (card 1 opened?),
cleared_level, max_opened_level, out_at_level, last_solve_at, wrong_count
```

## Player UI

`usePlayerGame` holds the `team_view` payload and re-reads it every few seconds
(plus on window focus and after every action). This is a poll, not realtime
push: players are anonymous, and `postgres_changes` is authorized per subscriber
against RLS, so an anon subscriber receives no events at all. Only the admin
dashboard gets realtime push.

- **LoginScreen** — team code entry (existing floating-label field, reskinned).
- **CardGridScreen** — replaces the old single-clue screen.
  - `RaceStatus` banner: `2 OF 5 TEAMS FOUND THIS CODE`, live, anonymous, for
    the level the team is currently hunting. Never names a rival, and never
    implies a threat — there are no slots to lose. Hidden for finished teams and
    non-live states.
  - `ScratchCard` grid, one per level: locked (padlock sprite + level number),
    foil (unscratched), or revealed clue.
  - `CodeEntry` for the current level, keeping the wrong-code shake, the
    already-used nudge and the cooldown countdown.
- **FinishedScreen** — treasure claimed. The first finisher gets the winner
  treatment; later finishers get their placing (2nd, 3rd, …).
- **WaitingScreen** — setup / paused / ended.

There is no eliminated screen in revision 2: a team that never finds a code
simply keeps hunting until the admin ends the game.

### ScratchCard component

Canvas foil over the clue. Pointer and touch drag erase with `destination-out`;
scratched fraction is sampled from the alpha channel of a downscaled copy every
few strokes, and crossing ~55% clears the rest. The first stroke fires
`open_card`, so the reveal survives refresh (`opened: true` renders bare text,
no canvas). Under `prefers-reduced-motion` the foil becomes a tap-to-reveal
button, and the clue is always in the accessibility tree regardless of scratch
state.

## Admin UI

Single **Dashboard** page, the admin landing page:

- Headline: game status, how many teams have finished, and the level spread —
  which level the pack is on and how many teams have cleared it.
- Live table from `admin_monitor` sorted by progress then last solve: team,
  started?, cards opened, level cleared, state (`playing` / `winner` /
  `finished`), last solve, wrong attempts. Winner highlighted, finishers
  marked with their placing, not-started flagged, and a team whose last solve
  is going stale is the signal that they need help.

No mismatch warning (team and level counts are unrelated now) and no
"out at level" column (nobody goes out).

**Teams panel** has a **Number of teams** field: type a count, press Generate,
get `Team 1…Team N` with codes ready to print, plus the existing
add/rename/regenerate/delete list.

**Stations panel** uses an explicit **Level** column, enforces contiguous
levels, and validates codes against `^[A-Z0-9]{3,12}$`.

Control and Print stay, Print showing the level number on each station sheet.

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
  redrawn 16×16-style, padlock for locked cards, coin for cleared levels, flag
  for the final level, and a ghost used for the wrong-code state (revision 2
  has no elimination for it to illustrate).
- **Motion** — a coin-flip reveal on unlock, a stepped blink on the active card,
  a shake on a wrong code, a slow CRT scanline overlay at low opacity. All gated
  behind `prefers-reduced-motion`.
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
4. `submit_code` rewrite (revision 1 shipped slots/sweep/last-standing here;
   revision 2 replaces it with a plain no-capacity clear — see the revision-2
   migrations appended after the original six).
5. `open_card` and `generate_teams`.
6. `start_game` / `reset_game` guards, `admin_monitor`, RLS for `card_opens`,
   and dropping the route-generation RPC.

## Testing

- **Unit, pure** — card lock/open derivation and placement ordering, as plain
  functions in `src/lib/`. (Revision 2 deletes the slot and sweep helpers along
  with the rules they served.)
- **Integration (Supabase)** — every team clearing the same level (no capacity
  limit); two teams clearing a level simultaneously both succeeding; the first
  finisher becoming `winner` and later ones `finished` with correct placings; a
  finished team refused further submits; nobody ever reaching `eliminated`;
  `open_card` idempotency and its locked-level rejection; locked clues absent
  from `team_view`; `generate_teams` topping up and refusing while live;
  `level_gap`; `reset_progress`; RLS denying anon reads of `stations` and
  `card_opens`.
- **Component** — card grid lock/foil/revealed states, race HUD copy, winner vs
  later-finisher screens, scratch reveal firing `open_card` exactly once,
  team-count generator form.
- Existing tests referencing `route_stops`, route generation or the single-clue
  `GameScreen` are rewritten, not deleted.

## Out of scope

Team chat, photo proof, hints and penalties, multiple concurrent games,
per-team custom ladders, elimination of any kind, manual progress overrides,
and sound effects.
