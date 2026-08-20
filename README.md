# 🗺️ Treasure Hunt

A web app for running an office treasure hunt: every team walks **its own
route** through a shared pool of locations, scratching open a card at each
level to reveal where its next code is hidden. Each stop has a code that
belongs to one team only, so a code copied from a rival is refused. The first
team to clear the last level wins; everyone else keeps hunting and is placed
by finish time. Nobody is ever eliminated.
Includes a realtime admin dashboard for the game master. The player view
refreshes every few seconds (players are anonymous, so they poll rather than
receive realtime push).

Spec: `docs/superpowers/specs/2026-08-20-elimination-scratch-cards-design.md`
(revision 2 — elimination removed; the filename keeps the word for link
stability only).

## Stack

React + Vite SPA · Supabase (Postgres, Auth, Realtime) · all game logic in
Postgres `SECURITY DEFINER` RPCs — players never get direct table access.

## Game rules

- **Locations are a shared pool.** A location is just a place with a clue —
  it has no level and no code of its own.
- **Every team has its own route** of `M` staggered legs through that pool
  (`team_stations`). Level 1 is unlocked for every team from the start;
  clearing level `L` unlocks level `L + 1`. Every team's route is the same
  length, and a team never visits the same location twice.
- **One treasure ends the hunt.** Level `M + 1` is the same final location for
  every team, with a single shared code (`game.treasure_station_id`,
  `game.treasure_code`). It may not sit on any team's route.
- **Every staggered stop has its own code, and that code belongs to one team.**
  Typing a code issued to another team is refused with "That code belongs to
  another team" and advances nobody. The treasure is the one exception: its code
  is shared, so anyone who learns it can send it.
- **The staggering rule:** no two teams are at the same location at the same
  level. The same location serves different teams at *different* levels, so
  there is never a queue at one place. This needs at least as many locations
  as teams — kickoff refuses otherwise.
- A code isn't consumed by being used — any number of teams can clear their
  own level `L`, in any order, at any time. No team is ever blocked, timed
  out, or knocked out of the hunt.
- **One demo team, which can never win.** A team flagged `is_demo` plays exactly
  like the others — own legs, own codes, same clue sheets — but its treasure
  submit only ever celebrates: no winner, no claim, and the real treasure stays
  out there. Its run rewinds from the Teams page at any time, including mid-hunt,
  and it is left out of the race counts and the kickoff snapshot so a demo never
  looks to a player like a rival closing in.
- **The first team to send the treasure code wins, and nobody else can.** A team
  that reaches an already-claimed treasure is told "The treasure was already
  claimed", does not advance, and there is no second place — no placings appear
  anywhere in the player app.
- **A win is invisible to everyone else.** It changes no other team's row and
  does not end the game: the hunt stays live until the admin presses End hunt,
  so a team still hunting learns nothing until it stands at the empty box. The
  dashboard shows the truth — `Winner`, and `Too late` for teams that got there
  after it was gone.
- Since nothing removes a team, a team that can't find a code just sits on
  its level. The admin dashboard surfaces this as a stale "last code" time
  and a rising miss count, so the game master can go help.

## Local development

Prereqs: Node ≥ 20, Docker Desktop, Supabase CLI (`brew install supabase/tap/supabase`).

```bash
npm install
npx supabase start      # boots the local stack (first run downloads images)
npx supabase db reset   # applies all migrations
npm run dev             # player app at /, admin at /admin
```

Create `.env.local` (gitignored) pointing the app at the local stack:

```bash
cp .env.example .env.local
```

Then set `VITE_SUPABASE_URL=http://127.0.0.1:54321` and set
`VITE_SUPABASE_ANON_KEY` to the anon key printed by `supabase status`.

`supabase db reset` also seeds a throwaway local game (never a hosted one):
admin `admin@test.local` / `test-password-123`, three teams and four locations
on staggered routes, with fixed codes so you can play on a phone without
opening the admin:

| Team | Code | Level 1 | Level 2 | Treasure (shared) |
|------|------|---------|---------|-------------------|
| Owls | `OWLS11` | Reception desk `RECEP1` | Kitchen fridge `KITCH2` | Server cupboard `TREAS9` |
| Mongooses | `MONG22` | Kitchen fridge `KITCH4` | Fire stairwell `STAIR5` | Server cupboard `TREAS9` |
| Foxes | `FOXX33` | Fire stairwell `STAIR7` | Loading bay `LOADB8` | Server cupboard `TREAS9` |
| Demo team | `DEMO11` | Loading bay `LOADB1` | Reception desk `RECEP9` | Server cupboard `TREAS9` |

The game is left in `setup`, so press **Start hunt** on Game control first.
Typing another team's code (say `KITCH4` as Owls) is the quickest way to see a
refusal; sending `TREAS9` from two teams in turn shows the win and then "the
treasure was already claimed". To get back to this state, run
`supabase db reset` again.

## Importing clues written elsewhere

Clues get written in Docs, Chat or Word, where bold is real formatting rather
than `**asterisks**`. Save the clipboard's HTML flavour and convert it:

```bash
xclip -selection clipboard -t text/html -o > paste.html   # X11
wl-paste --type text/html > paste.html                    # Wayland

# One heading per location, clue beneath it:
npx vite-node scripts/clues-from-html.ts paste.html > clues.local.sql

# Or a chat paste labelled `Team 1 - Q1:`, one set of clues per team:
npx vite-node scripts/seed-teams-from-chat.ts paste.html Pookalam Maveli Chenda Sadya \
  > seed.local.sql
```

Both print SQL and write nothing themselves — read it, then run it in the SQL
editor of the project you mean to change. Every statement is guarded, so running
a file twice adds nothing. `**bold**`, `*italic*`, line and verse breaks and
`---` rules are carried over; sender names, timestamps and other chat chrome are
dropped.

Per-team clues become one location per team-question (`<Team> · Clue N`), because
`stations.clue_text` is one clue per place: four teams with four different level-1
riddles need four rows. Neither script sets the treasure — that is one shared
place with one shared code, so pick it on the Stations page before starting.

`*.local.sql` and pasted sources are gitignored: they hold the clues and the
printed codes, which are the game's secrets.

## Tests

```bash
npm run test:unit          # component + pure-logic tests (jsdom)
npm run test:integration   # RPC/RLS tests against the local Supabase stack
npm test                   # both
```

Integration tests reset the local database between tests — never point them
at production. They read `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
`SUPABASE_SERVICE_ROLE_KEY` from the environment, falling back to the CLI's
well-known local keys.

## Production deploy

1. Create a Supabase project (free tier is fine).
2. `supabase link --project-ref <ref>` then `supabase db push` (applies the
   migrations).
3. In the Supabase dashboard:
   - **Authentication → Sign In / Up → disable "Allow new users to sign up".**
   - Authentication → Add user: create the game master account (this is the
     only account that can access the data).
4. Deploy the frontend to Vercel (or Netlify): set `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (from Project Settings → API) and build with
   `npm run build` (output `dist/`). The SPA rewrite that keeps deep links like
   `/admin/print` working is already committed for both hosts: `vercel.json`
   for Vercel, `public/_redirects` for Netlify. On any other host, point every
   unmatched path at `index.html` yourself.

## Game-day runbook

1. **Teams tab** — generate teams by count (or add them one at a time); each
   gets a secret team code. **Make demo** turns one of them into the demo team
   (the flag moves rather than duplicating); **Reset demo run** rewinds it, live
   game or not.
2. **Stations tab, Locations list** — create the pool of places: a name and
   the clue that leads *to* it. No codes and no levels here. Add at least as
   many locations as you have teams.

   Clues take a small markup: `**bold**`, `*italic*`, one newline for a new
   line, a blank line for a new verse, `---` for an ornament rule. The panel
   previews each clue exactly as the team will read it. Nothing else is
   interpreted — a clue containing HTML shows that HTML as text.
3. **Stations tab, The treasure** — pick the shared final location; the server
   mints its one code. It must be a place no team's route passes through.
4. **Stations tab, Team routes grid** — one row per team, one column per
   staggered leg (the treasure is not offered as a cell). Pick a location per cell; the server mints that cell's code and
   refuses a pick that would put two teams in the same place at the same
   level, or send one team to the same place twice. The grid lists what is
   still missing (empty cells, uneven route lengths, too few locations).
5. **Print tab** — a parchment-and-gold treasure slip, one sheet per location, holding one slip per team that
   visits it (post them side by side at that place), then team login slips to
   hand out, then a per-team master sheet for you — **admin copy, don't hand
   it out**.
6. **Game control → Start hunt** — refused unless the treasure is set and off
   every route, every team has a complete route of the same length, and there is
   one staggered location per team beyond the treasure. Players then open the site, enter their team code, and each team's
   own level 1 is unlocked.
   Watch the **dashboard** — the "Hunting" column names the location each team
   is looking for right now, the treasure included; the demo team is badged
   `DEMO` and never reads as a winner. A winning team gets confetti and a short
   synthesised fanfare (muted for reduced-motion, with a mute toggle). Scratching a card and submitting a code is always
   recorded server-side, so the board reflects exactly what happened, in
   order. Nobody is eliminated — a stalled team just shows a stale "last
   code" time and a rising miss count; go help them in person.
7. The first team to send the treasure code wins. Nobody is told — the losing
   teams keep hunting, and only a team that reaches the claimed treasure hears
   about it. Announce the winner in the room, then **End hunt**. To run it again
   later: **Reset progress** (keeps teams, locations, routes and the treasure).

## How cheating is prevented

- Clues and codes live only in Postgres; the browser receives a clue only
  after the team earns it.
- Clue markup is parsed to data and rendered as elements, never as an HTML
  string, so a clue can never inject markup or script into a player's phone.
- Wrong codes get a generic response (no probing which codes exist).
- Codes are team-specific: `submit_code` only ever compares against the
  calling team's own `team_stations` rows, so a code overheard from, or
  copied off, another team's slip is worthless.
- 5-second server-side cooldown between attempts per team.
- Players are anonymous; every player action goes through
  `security definer` RPCs (`team_view`, `submit_code`, `open_card`) — RLS
  denies all direct table access.
