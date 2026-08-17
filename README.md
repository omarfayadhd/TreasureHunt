# 🗺️ Office Treasure Hunt

A web app for running an office treasure hunt: teams unlock clues by entering
codes found at physical locations, racing to the final treasure code. Includes
a realtime admin dashboard for the game master.

Spec: `docs/superpowers/specs/2026-08-17-treasure-hunt-design.md`

## Stack

React + Vite SPA · Supabase (Postgres, Auth, Realtime) · all game logic in
Postgres `SECURITY DEFINER` RPCs — players never get direct table access.

## Local development

Prereqs: Node ≥ 20, Docker Desktop, Supabase CLI (`brew install supabase/tap/supabase`).

```bash
npm install
supabase start          # boots the local stack (first run downloads images)
supabase db reset       # applies all migrations
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

1. **Stations tab** — create every location: a clue that leads *to* it and the
   code posted *at* it. Mark exactly one station as the final treasure.
2. **Teams tab** — create the teams; each gets a secret team code.
3. **Game control → Generate routes** — every team gets the same stations in a
   different order (treasure always last). Review the preview.
4. **Print tab** — print station cards (post them at the locations) and team
   slips (hand them out).
5. **Game control → Start hunt** — players open the site, enter their team
   code, and the first clue appears.
6. Watch the **Live board**. Pause/resume if needed. Advance or roll back a
   team from the Teams tab if something goes sideways.
7. After the win: **End hunt**. To run it again later: **Reset progress**
   (keeps teams, stations and routes).

## How cheating is prevented

- Clues and codes live only in Postgres; the browser receives a clue only
  after the team earns it.
- Wrong codes get a generic response (no probing which codes exist).
- 5-second server-side cooldown between attempts per team.
- Players are anonymous; every player action goes through two RPCs
  (`team_login`, `submit_code`) — RLS denies all direct table access.
