# Per-team routes and per-team codes — design

Date: 2026-08-20
Status: approved, ready for planning
Builds on: `2026-08-20-elimination-scratch-cards-design.md` (revision 2), which
is the currently shipped behaviour. Everything not restated here is unchanged —
scratch cards, no elimination, first finisher wins, the arcade skin.

## Purpose

Today every team races the same ladder and a level's code is the same for
everyone. This change gives each team **its own route through the locations**
and **its own code at each location**, so:

- teams are spread out instead of moving as a pack — at any level, no two teams
  are at the same place;
- a code overheard, photographed or texted from another team is useless, because
  a code belongs to exactly one team.

## Game rules

Let `T` = teams, `S` = locations, `M` = levels.

- **Locations** are a shared pool: a name and a clue text each. They are no
  longer levels and no longer carry a code.
- **A route** is per team: for each level `1…M`, that team has one location and
  one code.
- **The staggering rule:** no two teams share a location at the same level. The
  same location serves different teams at different levels — that is the whole
  point of the rotation.
- **A team never visits the same location twice** across its own levels.
- Submitting your level `L` code clears level `L` and unlocks card `L+1`.
- Clearing level `M` claims the treasure. **Winning is unchanged:** nobody is
  eliminated, the first team to finish is the `winner`, later finishers are
  `finished` and placed by finish time, and unfinished teams keep playing.

Two requirements follow from the staggering rule and must be enforced, not
assumed:

- **`S >= T`** — level 3 needs a distinct location for every team at once.
- **`M <= S`** — a team cannot have more levels than there are places to visit
  without repeating one.

Every team must have the same `M`. A team with a shorter route would reach the
treasure sooner for no reason.

### Physical setup this implies

Every team visits every location it is routed to, at different times, so each
location must hold **one slip per team** — `T` slips per location, `T × M`
slips in total. A team reading another team's slip gains nothing.

## Data model

### Changed

`stations` becomes a plain location:

- Keeps `id`, `name`, `clue_text`, `sort_order` (display order in the admin list
  only — it no longer means "level").
- **Drops `code`** and the level constraints `stations_level_unique`,
  `stations_level_positive`, `stations_code_format`.

### Added

```sql
create table public.team_stations (
  team_id uuid not null references public.teams (id) on delete cascade,
  level int not null check (level >= 1),
  station_id uuid not null references public.stations (id) on delete restrict,
  code text not null check (code ~ '^[A-Z0-9]{3,12}$'),
  primary key (team_id, level),
  unique (team_id, station_id),   -- a team never revisits a location
  unique (level, station_id),      -- no two teams in one place at one level
  unique (code)                    -- a code belongs to exactly one team
);
```

Those four constraints ARE the rules — the grid cannot be saved into an invalid
state even if the UI's validation is bypassed. `on delete restrict` on
`station_id` stops a location being deleted out from under a live route;
deleting a team still cascades its route away.

`teams`, `card_opens`, `attempts`, `game` are unchanged.

### Data migration for the existing game

Production currently holds 3 locations and 2 teams with shared codes
(`BEAN42`, `LOBBY77`, `GOLD99`). Those cannot survive: a code now belongs to one
team. The migration seeds a valid rotation with freshly minted codes —
Owls: Kitchen → Reception → Meeting; Mongooses: Reception → Meeting → Kitchen —
and the admin reprints. Any game must be re-printed after this change.

## Server logic

### `team_view(p_team_code)`

`cards` now comes from the team's own route joined to `stations` for clue text.
Payload shape is unchanged except:

- `total` is the team's own level count.
- `race` stays `{ level, found, teams }`, where `found` counts teams whose
  `current_position >= level`. It is **level progress**, not code progress —
  a code no longer means the same thing to two teams.
- Each unlocked card also carries `location` (the location's name), so a player
  can see where they are headed as well as the riddle.

Clue text for a locked level still never reaches the client.

### `submit_code(p_team_code, p_code)`

1. Lock the team row; reject unknown team, `game_not_live`, `not_playing`, and
   the 5s cooldown, exactly as now.
2. Let `L = cleared + 1`. Expected code is `code from team_stations where
   team_id = me and level = L`.
3. A code from one of **this team's own earlier levels** → `already_used`.
4. A code that exists but belongs to **another team** → **`not_your_code`**, a
   new outcome: *"That code belongs to another team."* Recorded in `attempts`
   with `result = 'not_your_code'` so the dashboard can surface teams trading
   codes.
5. Any other non-match → `wrong`.
6. On a match: record `correct`, advance, and if `L = M` set `finished_at` with
   `status` = `winner` for the first finisher (still decided under the game-row
   lock with `clock_timestamp()`) or `finished` otherwise.

No capacity check — that stays gone.

### `start_game`

Level-gap checks on `stations` are replaced by route checks:

- at least one location and one team;
- **every team has a complete route**: levels `1…M` with no gaps
  (`route_incomplete`, naming the offending team);
- **every team has the same `M`** (`route_length_mismatch`);
- `S >= T` (`not_enough_locations`);
- every code present (guaranteed by `not null`) — reported as part of
  `route_incomplete`.

The staggering and no-revisit rules need no runtime check: the table's unique
constraints make a violating grid unsavable.

Adding or deleting teams and locations stays blocked while the game runs, and
route edits are blocked too — changing a route mid-hunt would invalidate posted
slips.

### `admin_monitor`

Gains `current_location` — the name of the location the team is hunting now
(its level `cleared + 1`), or null once finished. This is what lets a game
master walk to a struggling team.

### New admin RPCs

- `set_route_cell(p_team_id, p_level, p_station_id)` — upsert one cell, minting
  a code with the existing collision-checked generator if that cell has none.
- `set_route_code(p_team_id, p_level)` — re-mint just the code for one cell.
- `clear_route_cell(p_team_id, p_level)` — remove a cell.
- All admin-only: `assert_admin()`, revoked from `public, anon`, granted to
  `authenticated, service_role`, and each refuses while the game is running.

## Admin UI — all of it on the Stations page

Station setup is where this feature lives. The **Stations** page gains a second
section rather than a new page appearing elsewhere in the nav:

**Section 1 — Locations.** The existing list, minus the code column and minus
the level column: name, clue text, display order, reorder controls. A location
is now just a place with a riddle. This is the pool every team's route draws
from.

**Section 2 — Team routes.** A grid directly beneath it: teams down the side,
levels across the top. Each cell shows which location that team visits at that
level and the code posted there for them, with a location picker and a
"new code" button. An empty trailing column lets you extend every route by one
level.

Validation sits between the two sections, live, because a hand-authored
rotation is easy to get subtly wrong:

- cells still empty (which team, which level);
- teams whose route length differs from the rest;
- fewer locations than teams (level 3 cannot give five teams five distinct
  places out of four);
- a location already used by that team, or already taken at that level — the
  database refuses these, so the UI must explain the refusal in words rather
  than surface a constraint error.

Everything in both sections is disabled while the game is `live` or `paused`,
with the advisory banner the page already uses — editing a route mid-hunt would
invalidate slips already posted on walls.

**Print** regroups **by location**: one sheet per location listing every team's
slip for that place ("post these five at the Kitchen"), each slip showing the
team name and its code in large monospace. Per-team clue sheets stay as they are.

**Dashboard** adds the `current_location` column.

## Testing

- **Integration** — a code from another team returns `not_your_code` and does
  not advance anyone; each team's own code advances only that team; the four
  table constraints each reject their violation (same place same level, team
  revisiting a place, duplicate code, duplicate level for a team); `start_game`
  rejects incomplete routes, mismatched route lengths and `S < T`, and accepts a
  valid rotation; deleting a team cascades its route; deleting a location in use
  is refused; the winner/placement behaviour still holds with per-team codes.
- **Component** — the routes grid renders cells, surfaces each validation
  message, and calls the RPCs; print groups by location; the card grid shows a
  location name alongside the clue.
- **Existing suites** — every test that assumes one shared code per level is
  rewritten. That is most of `submit-code.test.ts` and `team-view.test.ts`.

## Migrations

Append-only, continuing the existing sequence:

1. `team_stations` with its four constraints; drop `stations.code` and the three
   station level/code constraints.
2. Seed the existing game's routes from its current stations (rotation + minted
   codes).
3. `team_view_json` rewrite (cards and `location` from the team's route).
4. `submit_code` rewrite (per-team expected code, `not_your_code`), plus
   `attempts.result` gaining `'not_your_code'`.
5. `start_game` route guards; `admin_monitor` gaining `current_location`.
6. The three route-editing RPCs.

## Out of scope

- **Auto-suggesting a rotation.** Routes are authored by hand by choice; the
  grid validates but never fills itself. Worth revisiting if 25 cells proves
  tedious in practice.
- Teams revisiting a location, routes of differing lengths, elimination of any
  kind, and manual progress overrides.
