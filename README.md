# 🗺️ Treasure Hunt

A web app for running an office treasure hunt: every team climbs the same
ladder of clues, scratching open a card at each level to reveal where the
next code is hidden. The first team to clear the last level wins; everyone
else keeps hunting and is placed by finish time. Nobody is ever eliminated.
Includes a realtime admin dashboard for the game master.

Spec: `docs/superpowers/specs/2026-08-20-elimination-scratch-cards-design.md`
(revision 2 — elimination removed; the filename keeps the word for link
stability only).

## Stack

React + Vite SPA · Supabase (Postgres, Auth, Realtime) · all game logic in
Postgres `SECURITY DEFINER` RPCs — players never get direct table access.

## Game rules

- There is one shared ladder of `M` clue levels, one station per level.
  Level 1 is unlocked for every team from the start; clearing level `L`
  unlocks level `L + 1`.
- **Every level has a code for every team.** A code isn't consumed by being
  used — any number of teams can clear the same level, in any order, at any
  time. No team is ever blocked, timed out, or knocked out of the hunt.
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
   `npm run build` (output `dist/`). `vercel.json` handles the SPA rewrite.

## Game-day runbook

1. **Teams tab** — generate teams by count (or add them one at a time); each
   gets a secret team code.
2. **Stations tab** — create one station per clue level: a clue that leads
   *to* it and the code posted *at* it. Levels must run 1, 2, 3… with no gaps
   — the same station ladder is shared by every team.
3. **Print tab** — print station cards (post them at the locations) and team
   slips (hand them out).
4. **Game control → Start hunt** — players open the site, enter their team
   code, and level 1 is unlocked for everyone.
5. Watch the **dashboard**. Scratching a card and submitting a code is always
   recorded server-side, so the board reflects exactly what happened, in
   order. Nobody is eliminated — a stalled team just shows a stale "last
   code" time and a rising miss count; go help them in person.
6. The first team to clear the final level becomes the winner; later
   finishers are placed by finish time and keep playing until you end the
   game. After the win: **End hunt**. To run it again later: **Reset
   progress** (keeps teams and stations).

## How cheating is prevented

- Clues and codes live only in Postgres; the browser receives a clue only
  after the team earns it.
- Wrong codes get a generic response (no probing which codes exist).
- 5-second server-side cooldown between attempts per team.
- Players are anonymous; every player action goes through two RPCs
  (`team_login`, `submit_code`) — RLS denies all direct table access.
