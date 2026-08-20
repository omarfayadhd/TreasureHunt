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
- **Every team has its own route** of `M` levels through that pool
  (`team_stations`). Level 1 is unlocked for every team from the start;
  clearing level `L` unlocks level `L + 1`. Every team's route is the same
  length, and a team never visits the same location twice.
- **Every stop has its own code, and that code belongs to one team.** Typing
  a code issued to another team is refused with "That code belongs to another
  team" and advances nobody.
- **The staggering rule:** no two teams are at the same location at the same
  level. The same location serves different teams at *different* levels, so
  there is never a queue at one place. This needs at least as many locations
  as teams — kickoff refuses otherwise.
- A code isn't consumed by being used — any number of teams can clear their
  own level `L`, in any order, at any time. No team is ever blocked, timed
  out, or knocked out of the hunt.
- The first team to clear the final level becomes the winner. Every later
  finisher is placed behind it by finish time (2nd, 3rd, …). A team finishing
  never ends another team's hunt — everyone still playing keeps playing until
  the admin ends the game.
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

Create a local admin user: open http://127.0.0.1:54323 → Authentication →
Add user (e.g. `admin@local.dev` / `local-admin-123`, auto-confirm), then sign
in at `/admin`.

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
   gets a secret team code.
2. **Stations tab, Locations list** — create the pool of places: a name and
   the clue that leads *to* it. No codes and no levels here. Add at least as
   many locations as you have teams.

   Clues take a small markup: `**bold**`, `*italic*`, one newline for a new
   line, a blank line for a new verse, `---` for an ornament rule. The panel
   previews each clue exactly as the team will read it. Nothing else is
   interpreted — a clue containing HTML shows that HTML as text.
3. **Stations tab, Team routes grid** — one row per team, one column per
   level. Pick a location per cell; the server mints that cell's code and
   refuses a pick that would put two teams in the same place at the same
   level, or send one team to the same place twice. The grid lists what is
   still missing (empty cells, uneven route lengths, too few locations).
4. **Print tab** — one sheet per location, holding one slip per team that
   visits it (post them side by side at that place), then team login slips to
   hand out, then a per-team master sheet for you — **admin copy, don't hand
   it out**.
5. **Game control → Start hunt** — refused unless every team has a complete
   route of the same length and there are at least as many locations as
   teams. Players then open the site, enter their team code, and each team's
   own level 1 is unlocked.
6. Watch the **dashboard** — the "Hunting" column names the location each
   team is looking for right now. Scratching a card and submitting a code is always
   recorded server-side, so the board reflects exactly what happened, in
   order. Nobody is eliminated — a stalled team just shows a stale "last
   code" time and a rising miss count; go help them in person.
7. The first team to clear the final level becomes the winner; later
   finishers are placed by finish time and keep playing until you end the
   game. After the win: **End hunt**. To run it again later: **Reset
   progress** (keeps teams, locations and routes).

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
