# Treasure Hunt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the office treasure hunt web app — a mobile-first player flow (team code → clue → find code → next clue → treasure) and a realtime admin dashboard — on Supabase.

**Architecture:** React + Vite SPA with two route trees (`/` player, `/admin` dashboard). All game logic lives in Postgres `SECURITY DEFINER` RPCs inside Supabase; players have zero direct table access (codes/clues never reach the browser until earned). Admin authenticates with Supabase Auth and gets full table access via RLS plus admin RPCs; the live board updates via Supabase Realtime.

**Tech Stack:** React 18, TypeScript (strict), Vite 5, react-router-dom 6, @supabase/supabase-js 2, Vitest 2 + React Testing Library, Supabase CLI (local stack via Docker).

**Spec:** `docs/superpowers/specs/2026-08-17-treasure-hunt-design.md` — the plan argues from the spec; read both.

## Global Constraints

- Node ≥ 20 with npm. Docker Desktop must be running for the local Supabase stack. Supabase CLI ≥ 2.0 (`brew install supabase/tap/supabase`).
- Frontend env vars: exactly `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Integration-test env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — defaults baked into `tests/integration/helpers.ts` are the CLI's well-known local dev keys; if `supabase status` prints different keys, export them before running tests.
- Dependencies: only the packages in Task 1's `package.json`. Adding any other package is out of scope.
- TypeScript strict mode. `npm run build` must pass with zero errors at every commit.
- Codes (station and team) are stored normalized `upper(trim(code))`. The server is the only authority on matching.
- Migrations are append-only SQL files under `supabase/migrations/`, applied locally with `supabase db reset` (re-runs all migrations from scratch — safe, local DB only).
- Player-facing copy: use the exact strings given in the tasks; component tests assert on them.
- Integration tests require the local stack: `supabase start` once, `supabase db reset` after adding a migration.
- Commit at the end of every task with the message given in its final step.

## File Structure

```
TreasureHunt/
  package.json  vite.config.ts  vitest.workspace.ts  tsconfig.json  index.html
  vercel.json  .gitignore  .env.example  .env.local (gitignored)  README.md
  supabase/
    config.toml                          # from `supabase init`
    migrations/
      20260817000001_schema.sql          # tables, constraints, realtime publication
      20260817000002_rls.sql             # RLS lockdown + admin policies
      20260817000003_team_login.sql      # player RPC: team_login
      20260817000004_submit_code.sql     # player RPC: submit_code
      20260817000005_game_lifecycle.sql  # admin RPCs: assert_admin, start/pause/resume/end, reset_progress
      20260817000006_routes_admin.sql    # admin RPCs: generate_routes, set_team_position
      20260817000007_admin_board.sql     # admin_board view
  tests/
    setup.ts                             # jest-dom matchers
    integration/
      helpers.ts                         # clients, resetDb, seeders
      schema.test.ts  rls.test.ts  team-login.test.ts  submit-code.test.ts
      game-lifecycle.test.ts  routes-admin.test.ts  admin-board.test.ts
  src/
    main.tsx  App.tsx  index.css  vite-env.d.ts
    lib/
      supabaseClient.ts  api.ts          # player RPC wrappers + shared types
      codes.ts  codes.test.ts            # WORD-## code generator
      ordinal.ts  ordinal.test.ts
    player/
      PlayerApp.tsx  PlayerApp.test.tsx  usePlayerGame.ts
      LoginScreen.tsx  GameScreen.tsx  WaitingScreen.tsx  FinishedScreen.tsx
    admin/
      AdminApp.tsx  AdminApp.test.tsx  AdminLogin.tsx
      adminApi.ts                        # admin queries + RPC wrappers (grows across tasks)
      sortBoard.ts  sortBoard.test.ts  timeAgo.ts  timeAgo.test.ts
      useAdminBoard.ts
      LiveBoard.tsx  LiveBoard.test.tsx
      TeamsPanel.tsx  TeamsPanel.test.tsx
      StationsPanel.tsx  StationsPanel.test.tsx
      GameControl.tsx  GameControl.test.tsx
      PrintPage.tsx  PrintPage.test.tsx
```

Responsibilities: `lib/api.ts` is the ONLY place player RPCs are called; `admin/adminApi.ts` is the ONLY place admin queries/RPCs are called. Components never import `supabaseClient` directly except `AdminApp`/`AdminLogin` (auth) and `useAdminBoard` (realtime channel).

---

### Task 1: Project scaffold & tooling

**Files:**
- Create: `package.json`, `vite.config.ts`, `vitest.workspace.ts`, `tsconfig.json`, `index.html`, `.gitignore`, `.env.example`, `.env.local`, `tests/setup.ts`, `src/vite-env.d.ts`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/lib/codes.ts`, `src/lib/codes.test.ts`
- Create (via CLI): `supabase/config.toml`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `generateCode(): string` from `src/lib/codes.ts` (returns e.g. `"TIGER-42"`, format `/^[A-Z]+-\d{2}$/`); working `npm run build`, `npm run test:unit`, and a running local Supabase stack.

- [ ] **Step 1: Write all config files**

`package.json`:

```json
{
  "name": "treasure-hunt",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run --passWithNoTests",
    "test:unit": "vitest run --project unit",
    "test:integration": "vitest run --project integration"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.4",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.2"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/node": "^22.5.5",
    "@types/react": "^18.3.8",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "typescript": "~5.6.2",
    "vite": "^5.4.7",
    "vitest": "^2.1.1"
  }
}
```

`vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
```

`vitest.workspace.ts`:

```ts
import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    extends: './vite.config.ts',
    test: {
      name: 'unit',
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./tests/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      env: {
        VITE_SUPABASE_URL: 'http://localhost:54321',
        VITE_SUPABASE_ANON_KEY: 'test-anon-key',
      },
    },
  },
  {
    test: {
      name: 'integration',
      environment: 'node',
      globals: true,
      include: ['tests/integration/**/*.test.ts'],
      testTimeout: 30000,
      fileParallelism: false,
    },
  },
])
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vitest/globals", "@testing-library/jest-dom", "node"]
  },
  "include": ["src", "tests"]
}
```

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🗺️</text></svg>" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Office Treasure Hunt</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`.gitignore`:

```
node_modules
dist
.env
.env.*
!.env.example
supabase/.temp
supabase/.branches
.DS_Store
```

`.env.example`:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

`.env.local` (local dev against the local stack; the anon key is the CLI's well-known local demo key — replace with the value from `supabase status` if yours differs):

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
```

`tests/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
```

`src/vite-env.d.ts` (required so TypeScript accepts `import.meta.env`):

```ts
/// <reference types="vite/client" />
```

`src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`src/App.tsx` (placeholder — replaced with the router in Task 11):

```tsx
export default function App() {
  return <h1>Office Treasure Hunt</h1>
}
```

`src/index.css` (base design tokens; player/admin/print sections are appended in Tasks 10, 11 and 16):

```css
:root {
  --bg: #f6f4ef;
  --ink: #23252b;
  --muted: #6b6f7b;
  --brand: #b45309;
  --brand-dark: #92400e;
  --accent: #0e7490;
  --good: #15803d;
  --bad: #b91c1c;
  --warn: #b45309;
  --card: #ffffff;
  --line: #e4e0d6;
  --radius: 14px;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", sans-serif;
  background: var(--bg);
  color: var(--ink);
}
h1, h2 { line-height: 1.2; }
button {
  font: inherit; border: none; border-radius: 10px;
  padding: 0.65rem 1.1rem; background: var(--brand); color: #fff;
  cursor: pointer; font-weight: 600;
}
button:disabled { opacity: 0.5; cursor: not-allowed; }
button.danger { background: var(--bad); }
button.link-btn {
  background: none; color: var(--accent); padding: 0.2rem 0.4rem;
  font-weight: 500; text-decoration: underline;
}
input, textarea {
  font: inherit; padding: 0.6rem 0.8rem; border: 1.5px solid var(--line);
  border-radius: 10px; width: 100%; background: #fff; color: var(--ink);
}
label { display: block; font-weight: 600; margin: 0.6rem 0 0.25rem; }
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: #f1efe9; padding: 0.1rem 0.35rem; border-radius: 6px;
}
.card { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 1.25rem; }
.msg { border-radius: 10px; padding: 0.6rem 0.9rem; font-weight: 600; }
.msg-bad { background: #fee2e2; color: var(--bad); }
.msg-good { background: #dcfce7; color: var(--good); }
.msg-warn { background: #fef3c7; color: var(--warn); }
.empty { color: var(--muted); font-style: italic; }
.center-screen {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; min-height: 100dvh; padding: 1.5rem; gap: 0.5rem;
}
```

- [ ] **Step 2: Write the failing unit test for the code generator**

`src/lib/codes.test.ts`:

```ts
import { generateCode } from './codes'

describe('generateCode', () => {
  it('produces WORD-NN codes', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateCode()).toMatch(/^[A-Z]+-\d{2}$/)
    }
  })

  it('produces varied codes', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateCode()))
    expect(codes.size).toBeGreaterThan(5)
  })
})
```

- [ ] **Step 3: Install and verify the test fails**

Run: `npm install`, then `npm run test:unit`
Expected: FAIL — `Cannot find module './codes'` (or equivalent resolve error).

- [ ] **Step 4: Implement the code generator**

`src/lib/codes.ts`:

```ts
const WORDS = [
  'TIGER', 'EAGLE', 'RIVER', 'MAPLE', 'COMET', 'NINJA', 'ROBOT', 'PIXEL',
  'MANGO', 'ZEBRA', 'FALCON', 'CACTUS', 'ROCKET', 'PANDA', 'STORM', 'EMBER',
  'ORBIT', 'QUARTZ', 'SPARK', 'LEMUR',
]

export function generateCode(): string {
  const word = WORDS[Math.floor(Math.random() * WORDS.length)]
  const num = Math.floor(Math.random() * 90) + 10
  return `${word}-${num}`
}
```

- [ ] **Step 5: Verify unit tests and build pass**

Run: `npm run test:unit` → PASS (2 tests). Run: `npm run build` → succeeds.

- [ ] **Step 6: Initialize the local Supabase project**

Run: `supabase init` (answer "n" to any editor-settings prompts, or pass `--with-vscode-settings=false --with-intellij-settings=false` if supported). Then `supabase start` (Docker must be running; first run downloads images). Then `supabase status` — confirm API URL `http://127.0.0.1:54321`. If the printed anon/service_role keys differ from the demo keys in this plan, note them for the integration-test env vars.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite+React+TS app with Vitest and local Supabase"
```

### Task 2: Database schema migration

**Files:**
- Create: `supabase/migrations/20260817000001_schema.sql`
- Create: `tests/integration/helpers.ts`
- Test: `tests/integration/schema.test.ts`

**Interfaces:**
- Consumes: running local Supabase stack (Task 1).
- Produces: tables `game`, `stations`, `teams`, `route_stops`, `attempts` exactly as specified in spec §3; test helpers `serviceClient()`, `anonClient()`, `adminClient()`, `resetDb(service?)`, `seedStations(service, regular)` (creates `regular` stations coded `CODE-1..N` plus one final station coded `FINAL-99`, returns rows sorted by `sort_order`), `createTeam(service, name, code)`, `setRoute(service, teamId, stationIds)`, `setGameStatus(service, status)`, `clearCooldown(service, teamId)`.

- [ ] **Step 1: Write the test helpers**

`tests/integration/helpers.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// The CLI's well-known local development keys (printed by `supabase status`).
// Override via env vars if your local stack prints different keys.
export const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
export const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
export const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
}

export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

const ADMIN_EMAIL = 'admin@test.local'
const ADMIN_PASSWORD = 'test-password-123'

export async function adminClient(): Promise<SupabaseClient> {
  const service = serviceClient()
  const { error } = await service.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
  })
  if (error && !error.message.toLowerCase().includes('already')) throw error
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  const { error: signInError } = await client.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  })
  if (signInError) throw signInError
  return client
}

function must<T extends { error: { message: string } | null }>(res: T): T {
  if (res.error) throw new Error(res.error.message)
  return res
}

export async function resetDb(service: SupabaseClient = serviceClient()): Promise<void> {
  must(await service.from('attempts').delete().gte('id', 0))
  must(await service.from('route_stops').delete().gte('position', 0))
  must(await service.from('teams').delete().gte('created_at', '1970-01-01'))
  must(await service.from('stations').delete().gte('created_at', '1970-01-01'))
  must(await service.from('game').update({ status: 'setup', started_at: null, ended_at: null }).eq('id', 1))
}

export type SeededStation = {
  id: string
  name: string
  clue_text: string
  code: string
  is_final: boolean
  sort_order: number
}

export async function seedStations(service: SupabaseClient, regular: number): Promise<SeededStation[]> {
  const rows = Array.from({ length: regular }, (_, i) => ({
    name: `Station ${i + 1}`,
    clue_text: `Clue leading to station ${i + 1}`,
    code: `CODE-${i + 1}`,
    is_final: false,
    sort_order: i + 1,
  }))
  rows.push({
    name: 'Treasure',
    clue_text: 'Clue leading to the treasure',
    code: 'FINAL-99',
    is_final: true,
    sort_order: regular + 1,
  })
  const { data, error } = await service.from('stations').insert(rows).select()
  if (error) throw new Error(error.message)
  return (data as SeededStation[]).sort((a, b) => a.sort_order - b.sort_order)
}

export async function createTeam(service: SupabaseClient, name: string, code: string) {
  const { data, error } = await service.from('teams').insert({ name, team_code: code }).select().single()
  if (error) throw new Error(error.message)
  return data as { id: string; name: string; team_code: string; current_position: number }
}

export async function setRoute(service: SupabaseClient, teamId: string, stationIds: string[]): Promise<void> {
  const rows = stationIds.map((sid, i) => ({ team_id: teamId, position: i + 1, station_id: sid }))
  must(await service.from('route_stops').insert(rows))
}

export async function setGameStatus(service: SupabaseClient, status: string): Promise<void> {
  must(
    await service
      .from('game')
      .update({ status, started_at: status === 'live' ? new Date().toISOString() : null })
      .eq('id', 1),
  )
}

// Backdates all of a team's attempts so the next submit is not cooldown-blocked.
export async function clearCooldown(service: SupabaseClient, teamId: string): Promise<void> {
  must(
    await service
      .from('attempts')
      .update({ created_at: new Date(Date.now() - 10_000).toISOString() })
      .eq('team_id', teamId),
  )
}
```

- [ ] **Step 2: Write the failing schema tests**

`tests/integration/schema.test.ts`:

```ts
import { serviceClient, resetDb, seedStations, createTeam } from './helpers'

const service = serviceClient()

describe('schema', () => {
  beforeEach(() => resetDb(service))

  it('has a single game row in setup', async () => {
    const { data, error } = await service.from('game').select('*')
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0]).toMatchObject({ id: 1, status: 'setup', started_at: null, ended_at: null })
  })

  it('rejects a second game row', async () => {
    const { error } = await service.from('game').insert({ id: 2 })
    expect(error).not.toBeNull()
  })

  it('rejects invalid game statuses', async () => {
    const { error } = await service.from('game').update({ status: 'bogus' }).eq('id', 1)
    expect(error).not.toBeNull()
  })

  it('rejects duplicate station codes', async () => {
    await seedStations(service, 2)
    const { error } = await service.from('stations').insert({ name: 'Dup', clue_text: 'x', code: 'CODE-1' })
    expect(error).not.toBeNull()
  })

  it('allows only one final station', async () => {
    await seedStations(service, 2) // includes one final station
    const { error } = await service
      .from('stations')
      .insert({ name: 'Second final', clue_text: 'x', code: 'OTHER-1', is_final: true })
    expect(error).not.toBeNull()
  })

  it('rejects duplicate team names and codes', async () => {
    await createTeam(service, 'Mongooses', 'TEAM-11')
    const { error: nameError } = await service.from('teams').insert({ name: 'Mongooses', team_code: 'TEAM-22' })
    expect(nameError).not.toBeNull()
    const { error: codeError } = await service.from('teams').insert({ name: 'Other', team_code: 'TEAM-11' })
    expect(codeError).not.toBeNull()
  })

  it('rejects a station appearing twice in one route', async () => {
    const stations = await seedStations(service, 2)
    const team = await createTeam(service, 'Mongooses', 'TEAM-11')
    const { error } = await service.from('route_stops').insert([
      { team_id: team.id, position: 1, station_id: stations[0].id },
      { team_id: team.id, position: 2, station_id: stations[0].id },
    ])
    expect(error).not.toBeNull()
  })

  it('rejects invalid attempt results', async () => {
    const team = await createTeam(service, 'Mongooses', 'TEAM-11')
    const { error } = await service
      .from('attempts')
      .insert({ team_id: team.id, submitted_code: 'X', result: 'nope' })
    expect(error).not.toBeNull()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:integration`
Expected: FAIL — errors like `relation "public.attempts" does not exist` (thrown from `resetDb`).

- [ ] **Step 4: Write the schema migration**

`supabase/migrations/20260817000001_schema.sql`:

```sql
-- Single-row game state
create table public.game (
  id int primary key default 1 check (id = 1),
  status text not null default 'setup' check (status in ('setup', 'live', 'paused', 'ended')),
  started_at timestamptz,
  ended_at timestamptz
);
insert into public.game (id) values (1);

-- Physical locations: a clue leads TO the station, the code is posted AT it
create table public.stations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  clue_text text not null,
  code text not null unique,
  is_final boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
-- At most one final (treasure) station
create unique index stations_single_final on public.stations (is_final) where is_final;

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  team_code text not null unique,
  current_position int not null default 0,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

-- Per-team shuffled visiting order; the team's next station is position current_position + 1
create table public.route_stops (
  team_id uuid not null references public.teams (id) on delete cascade,
  position int not null,
  station_id uuid not null references public.stations (id) on delete cascade,
  primary key (team_id, position),
  unique (team_id, station_id)
);

create table public.attempts (
  id bigint generated always as identity primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  submitted_code text not null,
  result text not null check (result in ('correct', 'wrong', 'already_used')),
  created_at timestamptz not null default now()
);
create index attempts_team_created on public.attempts (team_id, created_at desc);

-- Live board realtime feed
alter publication supabase_realtime add table public.teams, public.attempts;
```

- [ ] **Step 5: Apply the migration and verify tests pass**

Run: `supabase db reset`, then `npm run test:integration`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: database schema for game, stations, teams, routes and attempts"
```

---

### Task 3: RLS lockdown

**Files:**
- Create: `supabase/migrations/20260817000002_rls.sql`
- Test: `tests/integration/rls.test.ts`

**Interfaces:**
- Consumes: schema tables (Task 2), `anonClient`/`adminClient`/`resetDb`/`seedStations` helpers (Task 2).
- Produces: RLS enabled on all five tables; zero anon access; full access for the `authenticated` role.

- [ ] **Step 1: Write the failing RLS tests**

`tests/integration/rls.test.ts`:

```ts
import { anonClient, adminClient, serviceClient, resetDb, seedStations } from './helpers'

const service = serviceClient()

describe('row level security', () => {
  beforeEach(async () => {
    await resetDb(service)
    await seedStations(service, 2)
  })

  it('hides every table from anonymous clients', async () => {
    const anon = anonClient()
    for (const table of ['game', 'stations', 'teams', 'route_stops', 'attempts']) {
      const { data, error } = await anon.from(table).select('*')
      expect(error, table).toBeNull()
      expect(data, table).toEqual([])
    }
  })

  it('blocks anonymous writes', async () => {
    const anon = anonClient()
    const { error: insertError } = await anon.from('teams').insert({ name: 'Sneaky', team_code: 'HACK-01' })
    expect(insertError).not.toBeNull()
    const { error: updateError, data } = await anon
      .from('game')
      .update({ status: 'live' })
      .eq('id', 1)
      .select()
    // RLS either errors or matches zero rows — both mean the write did not land
    expect(updateError !== null || data?.length === 0).toBe(true)
    const { data: gameRow } = await service.from('game').select('status').single()
    expect(gameRow!.status).toBe('setup')
  })

  it('gives authenticated admins full access', async () => {
    const admin = await adminClient()
    const { data: stations, error } = await admin.from('stations').select('*')
    expect(error).toBeNull()
    expect(stations).toHaveLength(3)
    const { data: team, error: insertError } = await admin
      .from('teams')
      .insert({ name: 'Admin made', team_code: 'ADMIN-01' })
      .select()
      .single()
    expect(insertError).toBeNull()
    const { error: updateError } = await admin.from('teams').update({ name: 'Renamed' }).eq('id', team!.id)
    expect(updateError).toBeNull()
    const { error: deleteError } = await admin.from('teams').delete().eq('id', team!.id)
    expect(deleteError).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:integration -- rls`
Expected: FAIL — the first test finds data (anon can read everything before RLS is enabled).

- [ ] **Step 3: Write the RLS migration**

`supabase/migrations/20260817000002_rls.sql`:

```sql
alter table public.game enable row level security;
alter table public.stations enable row level security;
alter table public.teams enable row level security;
alter table public.route_stops enable row level security;
alter table public.attempts enable row level security;

-- Only admins sign in; players go through SECURITY DEFINER RPCs and get no policies at all.
create policy "admin full access" on public.game
  for all to authenticated using (true) with check (true);
create policy "admin full access" on public.stations
  for all to authenticated using (true) with check (true);
create policy "admin full access" on public.teams
  for all to authenticated using (true) with check (true);
create policy "admin full access" on public.route_stops
  for all to authenticated using (true) with check (true);
create policy "admin full access" on public.attempts
  for all to authenticated using (true) with check (true);
```

- [ ] **Step 4: Apply and verify all tests pass**

Run: `supabase db reset`, then `npm run test:integration`
Expected: PASS (schema tests still green — they use the service role, which bypasses RLS — plus 3 RLS tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: lock all tables down with RLS; admin-only direct access"
```

### Task 4: `team_login` RPC

**Files:**
- Create: `supabase/migrations/20260817000003_team_login.sql`
- Test: `tests/integration/team-login.test.ts`

**Interfaces:**
- Consumes: schema (Task 2), helpers (Task 2).
- Produces: `normalize_code(text) returns text`; `team_login(p_team_code text) returns jsonb` with exactly the contract in spec §5: failure `{ok:false, error:'invalid_team_code'}`; success `{ok:true, team_name, game_status, position, total, clue, finished, rank}` where `clue` is non-null only when the game is `live` and the team is unfinished, and `rank` is non-null only when finished.

- [ ] **Step 1: Write the failing tests**

`tests/integration/team-login.test.ts`:

```ts
import { anonClient, serviceClient, resetDb, seedStations, createTeam, setRoute, setGameStatus, type SeededStation } from './helpers'

const service = serviceClient()
const anon = anonClient()

describe('team_login', () => {
  let stations: SeededStation[]

  beforeEach(async () => {
    await resetDb(service)
    stations = await seedStations(service, 3) // CODE-1..3 + FINAL-99, in route order
  })

  async function login(teamCode: string) {
    const { data, error } = await anon.rpc('team_login', { p_team_code: teamCode })
    expect(error).toBeNull()
    return data
  }

  it('rejects unknown team codes', async () => {
    expect(await login('NOPE-00')).toEqual({ ok: false, error: 'invalid_team_code' })
  })

  it('returns team state without a clue while the game is in setup', async () => {
    const team = await createTeam(service, 'Mongooses', 'TEAM-11')
    await setRoute(service, team.id, stations.map(s => s.id))
    expect(await login('TEAM-11')).toEqual({
      ok: true,
      team_name: 'Mongooses',
      game_status: 'setup',
      position: 0,
      total: 4,
      clue: null,
      finished: false,
      rank: null,
    })
  })

  it('returns the next clue while live, ignoring team code case and spaces', async () => {
    const team = await createTeam(service, 'Mongooses', 'TEAM-11')
    await setRoute(service, team.id, stations.map(s => s.id))
    await setGameStatus(service, 'live')
    const result = await login('  team-11 ')
    expect(result).toMatchObject({
      ok: true,
      game_status: 'live',
      position: 0,
      total: 4,
      clue: 'Clue leading to station 1',
      finished: false,
    })
  })

  it('hides the clue while paused', async () => {
    const team = await createTeam(service, 'Mongooses', 'TEAM-11')
    await setRoute(service, team.id, stations.map(s => s.id))
    await setGameStatus(service, 'paused')
    expect(await login('TEAM-11')).toMatchObject({ ok: true, game_status: 'paused', clue: null })
  })

  it('reports finish state and rank', async () => {
    const first = await createTeam(service, 'First', 'TEAM-11')
    const second = await createTeam(service, 'Second', 'TEAM-22')
    await setRoute(service, first.id, stations.map(s => s.id))
    await setRoute(service, second.id, stations.map(s => s.id))
    await setGameStatus(service, 'live')
    const earlier = new Date(Date.now() - 60_000).toISOString()
    const later = new Date().toISOString()
    await service.from('teams').update({ current_position: 4, finished_at: earlier }).eq('id', first.id)
    await service.from('teams').update({ current_position: 4, finished_at: later }).eq('id', second.id)
    expect(await login('TEAM-22')).toMatchObject({ ok: true, finished: true, rank: 2, clue: null, position: 4 })
    expect(await login('TEAM-11')).toMatchObject({ ok: true, finished: true, rank: 1 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:integration -- team-login`
Expected: FAIL — PostgREST error `Could not find the function public.team_login` (surfaces as `error` non-null, so the `expect(error).toBeNull()` assertion fails).

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260817000003_team_login.sql`:

```sql
create or replace function public.normalize_code(p text)
returns text
language sql
immutable
as $$
  select upper(trim(p))
$$;

create or replace function public.team_login(p_team_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams%rowtype;
  v_status text;
  v_total int;
  v_clue text;
  v_rank int;
begin
  select * into v_team from teams where team_code = normalize_code(p_team_code);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_team_code');
  end if;

  select status into v_status from game where id = 1;
  select count(*)::int into v_total from route_stops where team_id = v_team.id;

  if v_team.finished_at is not null then
    select count(*)::int + 1 into v_rank
    from teams
    where finished_at is not null and finished_at < v_team.finished_at;
  end if;

  if v_status = 'live' and v_team.finished_at is null then
    select s.clue_text into v_clue
    from route_stops rs
    join stations s on s.id = rs.station_id
    where rs.team_id = v_team.id and rs.position = v_team.current_position + 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'team_name', v_team.name,
    'game_status', v_status,
    'position', v_team.current_position,
    'total', v_total,
    'clue', v_clue,
    'finished', v_team.finished_at is not null,
    'rank', v_rank
  );
end;
$$;

grant execute on function public.team_login(text) to anon, authenticated;
```

- [ ] **Step 4: Apply and verify tests pass**

Run: `supabase db reset`, then `npm run test:integration`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: team_login RPC — team code validation and current game view"
```

---

### Task 5: `submit_code` RPC

**Files:**
- Create: `supabase/migrations/20260817000004_submit_code.sql`
- Test: `tests/integration/submit-code.test.ts`

**Interfaces:**
- Consumes: schema, `normalize_code` (Task 4), helpers including `clearCooldown` (Task 2).
- Produces: `submit_code(p_team_code text, p_code text) returns jsonb` with exactly the contract in spec §5. Failures (`invalid_team_code`, `game_not_live`, `cooldown` + `retry_after_seconds`, `already_finished`) log no attempt. Outcomes: `{ok:true, correct:false, reason:'wrong'|'already_used'}`, `{ok:true, correct:true, finished:false, position, total, clue}`, `{ok:true, correct:true, finished:true, position, total, rank}`.

- [ ] **Step 1: Write the failing tests**

`tests/integration/submit-code.test.ts`:

```ts
import { anonClient, serviceClient, resetDb, seedStations, createTeam, setRoute, setGameStatus, clearCooldown, type SeededStation } from './helpers'

const service = serviceClient()
const anon = anonClient()

describe('submit_code', () => {
  let stations: SeededStation[]
  let teamId: string

  beforeEach(async () => {
    await resetDb(service)
    stations = await seedStations(service, 3) // route: CODE-1, CODE-2, CODE-3, FINAL-99
    const team = await createTeam(service, 'Mongooses', 'TEAM-11')
    teamId = team.id
    await setRoute(service, teamId, stations.map(s => s.id))
    await setGameStatus(service, 'live')
  })

  async function submit(code: string, teamCode = 'TEAM-11') {
    const { data, error } = await anon.rpc('submit_code', { p_team_code: teamCode, p_code: code })
    expect(error).toBeNull()
    return data
  }

  it('rejects unknown team codes', async () => {
    expect(await submit('CODE-1', 'NOPE-00')).toEqual({ ok: false, error: 'invalid_team_code' })
  })

  it('rejects submissions when the game is not live', async () => {
    await setGameStatus(service, 'setup')
    expect(await submit('CODE-1')).toEqual({ ok: false, error: 'game_not_live' })
    await setGameStatus(service, 'paused')
    expect(await submit('CODE-1')).toEqual({ ok: false, error: 'game_not_live' })
    const { data: attempts } = await service.from('attempts').select('*')
    expect(attempts).toEqual([])
  })

  it('logs wrong codes without advancing', async () => {
    expect(await submit('WRONG-1')).toEqual({ ok: true, correct: false, reason: 'wrong' })
    const { data: team } = await service.from('teams').select('current_position').eq('id', teamId).single()
    expect(team!.current_position).toBe(0)
    const { data: attempts } = await service.from('attempts').select('*')
    expect(attempts).toHaveLength(1)
    expect(attempts![0]).toMatchObject({ submitted_code: 'WRONG-1', result: 'wrong' })
  })

  it('treats codes from later stations on the route as wrong', async () => {
    expect(await submit('CODE-3')).toEqual({ ok: true, correct: false, reason: 'wrong' })
  })

  it('advances on the correct code, ignoring case and whitespace', async () => {
    expect(await submit('  code-1 ')).toEqual({
      ok: true,
      correct: true,
      finished: false,
      position: 1,
      total: 4,
      clue: 'Clue leading to station 2',
    })
    const { data: team } = await service.from('teams').select('current_position').eq('id', teamId).single()
    expect(team!.current_position).toBe(1)
  })

  it('enforces a 5 second cooldown between attempts', async () => {
    await submit('WRONG-1')
    const blocked = await submit('CODE-1')
    expect(blocked).toMatchObject({ ok: false, error: 'cooldown' })
    expect(blocked.retry_after_seconds).toBeGreaterThan(0)
    expect(blocked.retry_after_seconds).toBeLessThanOrEqual(5)
    // cooldown rejections log nothing, so the window is not extended
    const { data: attempts } = await service.from('attempts').select('*')
    expect(attempts).toHaveLength(1)
    await clearCooldown(service, teamId)
    expect(await submit('CODE-1')).toMatchObject({ correct: true })
  })

  it('flags codes the team already used', async () => {
    await submit('CODE-1')
    await clearCooldown(service, teamId)
    expect(await submit('CODE-1')).toEqual({ ok: true, correct: false, reason: 'already_used' })
    const { data: attempts } = await service.from('attempts').select('result').order('id')
    expect(attempts!.map(a => a.result)).toEqual(['correct', 'already_used'])
  })

  it('finishes the hunt with a rank on the final code, then blocks further submits', async () => {
    for (const code of ['CODE-1', 'CODE-2', 'CODE-3']) {
      expect(await submit(code)).toMatchObject({ correct: true, finished: false })
      await clearCooldown(service, teamId)
    }
    expect(await submit('FINAL-99')).toEqual({
      ok: true,
      correct: true,
      finished: true,
      position: 4,
      total: 4,
      rank: 1,
    })
    const { data: team } = await service.from('teams').select('finished_at').eq('id', teamId).single()
    expect(team!.finished_at).not.toBeNull()
    await clearCooldown(service, teamId)
    expect(await submit('CODE-2')).toEqual({ ok: false, error: 'already_finished' })
  })

  it('ranks later finishers behind earlier ones', async () => {
    for (const code of ['CODE-1', 'CODE-2', 'CODE-3', 'FINAL-99']) {
      await submit(code)
      await clearCooldown(service, teamId)
    }
    const second = await createTeam(service, 'Second', 'TEAM-22')
    await setRoute(service, second.id, stations.map(s => s.id))
    for (const code of ['CODE-1', 'CODE-2', 'CODE-3']) {
      await submit(code, 'TEAM-22')
      await clearCooldown(service, second.id)
    }
    expect(await submit('FINAL-99', 'TEAM-22')).toMatchObject({ finished: true, rank: 2 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:integration -- submit-code`
Expected: FAIL — `Could not find the function public.submit_code`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260817000004_submit_code.sql`:

```sql
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
  v_next stations%rowtype;
  v_clue text;
  v_rank int;
begin
  -- Lock the team row: serializes concurrent submits from the same team
  select * into v_team from teams where team_code = normalize_code(p_team_code) for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_team_code');
  end if;

  select status into v_status from game where id = 1;
  if v_status <> 'live' then
    return jsonb_build_object('ok', false, 'error', 'game_not_live');
  end if;

  if v_team.finished_at is not null then
    return jsonb_build_object('ok', false, 'error', 'already_finished');
  end if;

  select max(created_at) into v_last from attempts where team_id = v_team.id;
  if v_last is not null and v_last > now() - interval '5 seconds' then
    v_wait := ceil(extract(epoch from (v_last + interval '5 seconds') - now()))::int;
    return jsonb_build_object('ok', false, 'error', 'cooldown', 'retry_after_seconds', greatest(v_wait, 1));
  end if;

  select count(*)::int into v_total from route_stops where team_id = v_team.id;

  -- A code the team already solved gets a friendly nudge, not a generic wrong
  if exists (
    select 1
    from route_stops rs
    join stations s on s.id = rs.station_id
    where rs.team_id = v_team.id
      and rs.position <= v_team.current_position
      and s.code = v_code
  ) then
    insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'already_used');
    return jsonb_build_object('ok', true, 'correct', false, 'reason', 'already_used');
  end if;

  select s.* into v_next
  from route_stops rs
  join stations s on s.id = rs.station_id
  where rs.team_id = v_team.id and rs.position = v_team.current_position + 1;

  if v_next.code is distinct from v_code then
    insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'wrong');
    return jsonb_build_object('ok', true, 'correct', false, 'reason', 'wrong');
  end if;

  insert into attempts (team_id, submitted_code, result) values (v_team.id, v_code, 'correct');
  update teams
  set current_position = current_position + 1,
      finished_at = case when v_team.current_position + 1 = v_total then now() else null end
  where id = v_team.id;

  if v_team.current_position + 1 = v_total then
    select count(*)::int + 1 into v_rank
    from teams t
    where t.finished_at is not null
      and t.id <> v_team.id
      and t.finished_at < (select finished_at from teams where id = v_team.id);
    return jsonb_build_object(
      'ok', true, 'correct', true, 'finished', true,
      'position', v_total, 'total', v_total, 'rank', v_rank
    );
  end if;

  select s.clue_text into v_clue
  from route_stops rs
  join stations s on s.id = rs.station_id
  where rs.team_id = v_team.id and rs.position = v_team.current_position + 2;

  return jsonb_build_object(
    'ok', true, 'correct', true, 'finished', false,
    'position', v_team.current_position + 1, 'total', v_total, 'clue', v_clue
  );
end;
$$;

grant execute on function public.submit_code(text, text) to anon, authenticated;
```

- [ ] **Step 4: Apply and verify tests pass**

Run: `supabase db reset`, then `npm run test:integration`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: submit_code RPC — validation, cooldown, advancement and finish rank"
```

### Task 6: Game lifecycle admin RPCs

**Files:**
- Create: `supabase/migrations/20260817000005_game_lifecycle.sql`
- Test: `tests/integration/game-lifecycle.test.ts`

**Interfaces:**
- Consumes: schema, helpers, `adminClient()` (Task 2).
- Produces: `assert_admin()` (raises `not_authorized` for anonymous callers); `start_game()`, `pause_game()`, `resume_game()`, `end_game()`, `reset_progress()` — all return jsonb `{ok:true, status:'<new status>'}` or `{ok:false, error:'<code>'}`. `start_game` validates: exactly one final station exists (`no_final_station`), at least one team (`no_teams`), every team has a route covering all stations (`teams_missing_routes` + `teams` count). Transitions: setup→live (`not_in_setup`), live→paused (`not_live`), paused→live (`not_paused`), live/paused→ended (`not_running`). `reset_progress` works from any status.

- [ ] **Step 1: Write the failing tests**

`tests/integration/game-lifecycle.test.ts`:

```ts
import { anonClient, adminClient, serviceClient, resetDb, seedStations, createTeam, setRoute } from './helpers'
import type { SupabaseClient } from '@supabase/supabase-js'

const service = serviceClient()
let admin: SupabaseClient

beforeAll(async () => {
  admin = await adminClient()
})

describe('game lifecycle RPCs', () => {
  beforeEach(() => resetDb(service))

  async function rpc(fn: string) {
    const { data, error } = await admin.rpc(fn)
    expect(error, fn).toBeNull()
    return data
  }

  it('blocks anonymous callers', async () => {
    const { error } = await anonClient().rpc('start_game')
    expect(error).not.toBeNull()
  })

  it('start_game validates setup completeness step by step', async () => {
    expect(await rpc('start_game')).toEqual({ ok: false, error: 'no_final_station' })
    const stations = await seedStations(service, 2)
    expect(await rpc('start_game')).toEqual({ ok: false, error: 'no_teams' })
    const team = await createTeam(service, 'T1', 'TEAM-11')
    expect(await rpc('start_game')).toEqual({ ok: false, error: 'teams_missing_routes', teams: 1 })
    await setRoute(service, team.id, stations.map(s => s.id))
    expect(await rpc('start_game')).toEqual({ ok: true, status: 'live' })
    const { data: game } = await service.from('game').select('*').single()
    expect(game!.status).toBe('live')
    expect(game!.started_at).not.toBeNull()
    // cannot start twice
    expect(await rpc('start_game')).toEqual({ ok: false, error: 'not_in_setup' })
  })

  it('pause, resume and end follow the allowed transitions', async () => {
    const stations = await seedStations(service, 1)
    const team = await createTeam(service, 'T1', 'TEAM-11')
    await setRoute(service, team.id, stations.map(s => s.id))

    expect(await rpc('pause_game')).toEqual({ ok: false, error: 'not_live' })
    expect(await rpc('resume_game')).toEqual({ ok: false, error: 'not_paused' })
    expect(await rpc('end_game')).toEqual({ ok: false, error: 'not_running' })

    await rpc('start_game')
    expect(await rpc('pause_game')).toEqual({ ok: true, status: 'paused' })
    expect(await rpc('resume_game')).toEqual({ ok: true, status: 'live' })
    expect(await rpc('end_game')).toEqual({ ok: true, status: 'ended' })
    const { data: game } = await service.from('game').select('*').single()
    expect(game!.ended_at).not.toBeNull()
    expect(await rpc('end_game')).toEqual({ ok: false, error: 'not_running' })
  })

  it('reset_progress clears progress but keeps teams, stations and routes', async () => {
    const stations = await seedStations(service, 2)
    const team = await createTeam(service, 'T1', 'TEAM-11')
    await setRoute(service, team.id, stations.map(s => s.id))
    await rpc('start_game')
    await service.from('teams').update({ current_position: 3, finished_at: new Date().toISOString() }).eq('id', team.id)
    await service.from('attempts').insert({ team_id: team.id, submitted_code: 'CODE-1', result: 'correct' })

    expect(await rpc('reset_progress')).toEqual({ ok: true, status: 'setup' })

    const { data: teamAfter } = await service.from('teams').select('*').eq('id', team.id).single()
    expect(teamAfter).toMatchObject({ current_position: 0, finished_at: null })
    const { data: attempts } = await service.from('attempts').select('*')
    expect(attempts).toEqual([])
    const { data: stops } = await service.from('route_stops').select('*')
    expect(stops).toHaveLength(3)
    const { data: game } = await service.from('game').select('*').single()
    expect(game).toMatchObject({ status: 'setup', started_at: null, ended_at: null })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:integration -- game-lifecycle`
Expected: FAIL — `Could not find the function public.start_game`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260817000005_game_lifecycle.sql`:

```sql
create or replace function public.assert_admin()
returns void
language plpgsql
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authorized';
  end if;
end;
$$;

create or replace function public.start_game()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_station_count int;
  v_missing int;
begin
  perform assert_admin();
  select status into v_status from game where id = 1;
  if v_status <> 'setup' then
    return jsonb_build_object('ok', false, 'error', 'not_in_setup');
  end if;
  if not exists (select 1 from stations where is_final) then
    return jsonb_build_object('ok', false, 'error', 'no_final_station');
  end if;
  if not exists (select 1 from teams) then
    return jsonb_build_object('ok', false, 'error', 'no_teams');
  end if;
  select count(*) into v_station_count from stations;
  select count(*)::int into v_missing
  from teams t
  where (select count(*) from route_stops rs where rs.team_id = t.id) <> v_station_count;
  if v_missing > 0 then
    return jsonb_build_object('ok', false, 'error', 'teams_missing_routes', 'teams', v_missing);
  end if;
  update game set status = 'live', started_at = now(), ended_at = null where id = 1;
  return jsonb_build_object('ok', true, 'status', 'live');
end;
$$;

create or replace function public.pause_game()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  perform assert_admin();
  select status into v_status from game where id = 1;
  if v_status <> 'live' then
    return jsonb_build_object('ok', false, 'error', 'not_live');
  end if;
  update game set status = 'paused' where id = 1;
  return jsonb_build_object('ok', true, 'status', 'paused');
end;
$$;

create or replace function public.resume_game()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  perform assert_admin();
  select status into v_status from game where id = 1;
  if v_status <> 'paused' then
    return jsonb_build_object('ok', false, 'error', 'not_paused');
  end if;
  update game set status = 'live' where id = 1;
  return jsonb_build_object('ok', true, 'status', 'live');
end;
$$;

create or replace function public.end_game()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  perform assert_admin();
  select status into v_status from game where id = 1;
  if v_status not in ('live', 'paused') then
    return jsonb_build_object('ok', false, 'error', 'not_running');
  end if;
  update game set status = 'ended', ended_at = now() where id = 1;
  return jsonb_build_object('ok', true, 'status', 'ended');
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
  update teams set current_position = 0, finished_at = null;
  delete from attempts;
  update game set status = 'setup', started_at = null, ended_at = null where id = 1;
  return jsonb_build_object('ok', true, 'status', 'setup');
end;
$$;

-- Admin functions are not callable anonymously
revoke execute on function public.start_game() from public, anon;
revoke execute on function public.pause_game() from public, anon;
revoke execute on function public.resume_game() from public, anon;
revoke execute on function public.end_game() from public, anon;
revoke execute on function public.reset_progress() from public, anon;
grant execute on function public.start_game() to authenticated, service_role;
grant execute on function public.pause_game() to authenticated, service_role;
grant execute on function public.resume_game() to authenticated, service_role;
grant execute on function public.end_game() to authenticated, service_role;
grant execute on function public.reset_progress() to authenticated, service_role;
```

- [ ] **Step 4: Apply and verify tests pass**

Run: `supabase db reset`, then `npm run test:integration`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: game lifecycle admin RPCs — start/pause/resume/end/reset"
```

---

### Task 7: Route generation & position override RPCs

**Files:**
- Create: `supabase/migrations/20260817000006_routes_admin.sql`
- Test: `tests/integration/routes-admin.test.ts`

**Interfaces:**
- Consumes: schema, `assert_admin()` (Task 6), helpers.
- Produces: `generate_routes() returns jsonb` — `{ok:true, teams_routed:n}` or `{ok:false, error:'no_final_station'|'no_regular_stations'}`. In `setup` it wipes and regenerates all routes; in any other status it only creates routes for teams that lack one. Every route = all regular stations shuffled per team + final station last; starting stations assigned round-robin from a shuffled list (distinct while team count ≤ regular-station count). `set_team_position(p_team_id uuid, p_position int) returns jsonb` — `{ok:true, position:n}` (clamped to `[0, route length]`; sets `finished_at` at the end — keeping an existing value — and clears it otherwise) or `{ok:false, error:'invalid_team'}`.

- [ ] **Step 1: Write the failing tests**

`tests/integration/routes-admin.test.ts`:

```ts
import { anonClient, adminClient, serviceClient, resetDb, seedStations, createTeam, setRoute } from './helpers'
import type { SupabaseClient } from '@supabase/supabase-js'

const service = serviceClient()
let admin: SupabaseClient

beforeAll(async () => {
  admin = await adminClient()
})

type Stop = { team_id: string; position: number; station_id: string }

async function routesByTeam(): Promise<Map<string, Stop[]>> {
  const { data } = await service.from('route_stops').select('*').order('position')
  const map = new Map<string, Stop[]>()
  for (const stop of (data as Stop[]) ?? []) {
    if (!map.has(stop.team_id)) map.set(stop.team_id, [])
    map.get(stop.team_id)!.push(stop)
  }
  return map
}

describe('generate_routes', () => {
  beforeEach(() => resetDb(service))

  it('blocks anonymous callers', async () => {
    const { error } = await anonClient().rpc('generate_routes')
    expect(error).not.toBeNull()
  })

  it('requires a final station and at least one regular station', async () => {
    expect((await admin.rpc('generate_routes')).data).toEqual({ ok: false, error: 'no_final_station' })
    await service.from('stations').insert({ name: 'Only final', clue_text: 'x', code: 'FINAL-1', is_final: true })
    expect((await admin.rpc('generate_routes')).data).toEqual({ ok: false, error: 'no_regular_stations' })
  })

  it('gives every team a full route ending at the treasure, with distinct starts', async () => {
    const stations = await seedStations(service, 4)
    const finalId = stations.find(s => s.is_final)!.id
    const allIds = new Set(stations.map(s => s.id))
    for (const [name, code] of [['A', 'TEAM-11'], ['B', 'TEAM-22'], ['C', 'TEAM-33']]) {
      await createTeam(service, name, code)
    }
    const { data } = await admin.rpc('generate_routes')
    expect(data).toEqual({ ok: true, teams_routed: 3 })

    const routes = await routesByTeam()
    expect(routes.size).toBe(3)
    const starts = new Set<string>()
    for (const stops of routes.values()) {
      expect(stops).toHaveLength(5)
      expect(stops[stops.length - 1].station_id).toBe(finalId)
      expect(new Set(stops.map(s => s.station_id))).toEqual(allIds)
      starts.add(stops[0].station_id)
    }
    expect(starts.size).toBe(3) // 3 teams ≤ 4 regular stations → all distinct starts
  })

  it('regenerates everything in setup but only fills gaps when live', async () => {
    const stations = await seedStations(service, 3)
    const teamA = await createTeam(service, 'A', 'TEAM-11')
    await admin.rpc('generate_routes')
    await admin.rpc('start_game')

    const before = [...(await routesByTeam()).get(teamA.id)!.map(s => s.station_id)]
    const teamB = await createTeam(service, 'B', 'TEAM-22')
    const { data } = await admin.rpc('generate_routes')
    expect(data).toEqual({ ok: true, teams_routed: 1 }) // only the new team

    const after = await routesByTeam()
    expect(after.get(teamA.id)!.map(s => s.station_id)).toEqual(before) // untouched
    expect(after.get(teamB.id)).toHaveLength(4)
  })
})

describe('set_team_position', () => {
  beforeEach(() => resetDb(service))

  it('clamps the position and maintains finished_at', async () => {
    const stations = await seedStations(service, 2) // route length 3
    const team = await createTeam(service, 'A', 'TEAM-11')
    await setRoute(service, team.id, stations.map(s => s.id))

    expect((await admin.rpc('set_team_position', { p_team_id: team.id, p_position: 99 })).data)
      .toEqual({ ok: true, position: 3 })
    const { data: t1 } = await service.from('teams').select('*').eq('id', team.id).single()
    expect(t1!.finished_at).not.toBeNull()

    expect((await admin.rpc('set_team_position', { p_team_id: team.id, p_position: 1 })).data)
      .toEqual({ ok: true, position: 1 })
    const { data: t2 } = await service.from('teams').select('*').eq('id', team.id).single()
    expect(t2!.finished_at).toBeNull()

    expect((await admin.rpc('set_team_position', { p_team_id: team.id, p_position: -5 })).data)
      .toEqual({ ok: true, position: 0 })
  })

  it('rejects unknown teams', async () => {
    const { data } = await admin.rpc('set_team_position', {
      p_team_id: '00000000-0000-0000-0000-000000000000',
      p_position: 1,
    })
    expect(data).toEqual({ ok: false, error: 'invalid_team' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:integration -- routes-admin`
Expected: FAIL — `Could not find the function public.generate_routes`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260817000006_routes_admin.sql`:

```sql
create or replace function public.generate_routes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_final uuid;
  v_regular uuid[];
  v_n int;
  v_teams uuid[];
  v_team uuid;
  v_i int := 0;
  v_start uuid;
  v_rest uuid[];
  v_route uuid[];
  v_created int := 0;
begin
  perform assert_admin();
  select status into v_status from game where id = 1;

  select id into v_final from stations where is_final;
  if v_final is null then
    return jsonb_build_object('ok', false, 'error', 'no_final_station');
  end if;

  select coalesce(array_agg(id order by random()), '{}'::uuid[]) into v_regular
  from stations where not is_final;
  v_n := coalesce(array_length(v_regular, 1), 0);
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_regular_stations');
  end if;

  if v_status = 'setup' then
    delete from route_stops;
    select coalesce(array_agg(id order by created_at), '{}'::uuid[]) into v_teams from teams;
  else
    select coalesce(array_agg(id order by created_at), '{}'::uuid[]) into v_teams
    from teams t
    where not exists (select 1 from route_stops rs where rs.team_id = t.id);
  end if;

  foreach v_team in array coalesce(v_teams, '{}'::uuid[]) loop
    -- Round-robin start over the shuffled regular stations, then shuffle the rest
    v_start := v_regular[(v_i % v_n) + 1];
    select coalesce(array_agg(u.id order by random()), '{}'::uuid[]) into v_rest
    from unnest(v_regular) as u(id)
    where u.id <> v_start;
    v_route := array[v_start] || v_rest || array[v_final];
    insert into route_stops (team_id, position, station_id)
    select v_team, r.ord, r.sid
    from unnest(v_route) with ordinality as r(sid, ord);
    v_i := v_i + 1;
    v_created := v_created + 1;
  end loop;

  return jsonb_build_object('ok', true, 'teams_routed', v_created);
end;
$$;

create or replace function public.set_team_position(p_team_id uuid, p_position int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int;
  v_pos int;
begin
  perform assert_admin();
  if not exists (select 1 from teams where id = p_team_id) then
    return jsonb_build_object('ok', false, 'error', 'invalid_team');
  end if;
  select count(*)::int into v_total from route_stops where team_id = p_team_id;
  v_pos := least(greatest(p_position, 0), v_total);
  update teams
  set current_position = v_pos,
      finished_at = case
        when v_total > 0 and v_pos = v_total then coalesce(finished_at, now())
        else null
      end
  where id = p_team_id;
  return jsonb_build_object('ok', true, 'position', v_pos);
end;
$$;

revoke execute on function public.generate_routes() from public, anon;
revoke execute on function public.set_team_position(uuid, int) from public, anon;
grant execute on function public.generate_routes() to authenticated, service_role;
grant execute on function public.set_team_position(uuid, int) to authenticated, service_role;
```

- [ ] **Step 4: Apply and verify tests pass**

Run: `supabase db reset`, then `npm run test:integration`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: route generation and manual position override RPCs"
```

---

### Task 8: `admin_board` view

**Files:**
- Create: `supabase/migrations/20260817000007_admin_board.sql`
- Test: `tests/integration/admin-board.test.ts`

**Interfaces:**
- Consumes: schema; `submit_code` (Task 5) to produce realistic data.
- Produces: view `admin_board` with columns `id, name, team_code, current_position, finished_at, created_at, total (int), next_station (text|null), last_solve_at (timestamptz|null)` — one row per team; respects RLS via `security_invoker` (admins see all, anon sees nothing).

- [ ] **Step 1: Write the failing tests**

`tests/integration/admin-board.test.ts`:

```ts
import { anonClient, adminClient, serviceClient, resetDb, seedStations, createTeam, setRoute, setGameStatus } from './helpers'
import type { SupabaseClient } from '@supabase/supabase-js'

const service = serviceClient()
const anon = anonClient()
let admin: SupabaseClient

beforeAll(async () => {
  admin = await adminClient()
})

describe('admin_board view', () => {
  beforeEach(() => resetDb(service))

  it('summarizes team progress for admins', async () => {
    const stations = await seedStations(service, 2)
    const team = await createTeam(service, 'Mongooses', 'TEAM-11')
    await setRoute(service, team.id, stations.map(s => s.id))
    await setGameStatus(service, 'live')
    await anon.rpc('submit_code', { p_team_code: 'TEAM-11', p_code: 'CODE-1' })

    const { data, error } = await admin.from('admin_board').select('*')
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0]).toMatchObject({
      name: 'Mongooses',
      team_code: 'TEAM-11',
      current_position: 1,
      total: 3,
      next_station: 'Station 2',
      finished_at: null,
    })
    expect(data![0].last_solve_at).not.toBeNull()
  })

  it('shows null next_station for teams without routes', async () => {
    await createTeam(service, 'Routeless', 'TEAM-22')
    const { data } = await admin.from('admin_board').select('*')
    expect(data![0]).toMatchObject({ name: 'Routeless', total: 0, next_station: null, last_solve_at: null })
  })

  it('returns nothing to anonymous clients', async () => {
    await createTeam(service, 'Hidden', 'TEAM-33')
    const { data, error } = await anon.from('admin_board').select('*')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:integration -- admin-board`
Expected: FAIL — `relation "public.admin_board" does not exist` (surfaces as a PostgREST error).

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260817000007_admin_board.sql`:

```sql
create view public.admin_board
with (security_invoker = true) as
select
  t.id,
  t.name,
  t.team_code,
  t.current_position,
  t.finished_at,
  t.created_at,
  (select count(*)::int from route_stops rs where rs.team_id = t.id) as total,
  (
    select s.name
    from route_stops rs
    join stations s on s.id = rs.station_id
    where rs.team_id = t.id and rs.position = t.current_position + 1
  ) as next_station,
  (
    select max(a.created_at)
    from attempts a
    where a.team_id = t.id and a.result = 'correct'
  ) as last_solve_at
from teams t;
```

- [ ] **Step 4: Apply and verify tests pass**

Run: `supabase db reset`, then `npm run test:integration`
Expected: PASS (all suites — the full backend is now green).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: admin_board view for the live dashboard"
```

### Task 9: Frontend lib — Supabase client, player API wrappers, ordinal helper

**Files:**
- Create: `src/lib/supabaseClient.ts`, `src/lib/api.ts`, `src/lib/ordinal.ts`
- Test: `src/lib/ordinal.test.ts`

**Interfaces:**
- Consumes: env vars `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`; deployed RPCs (Tasks 4–5).
- Produces: `supabase` (shared client); types `GameStatus`, `TeamView`, `LoginResult`, `SubmitResult`; `teamLogin(teamCode: string): Promise<LoginResult>`; `submitCode(teamCode: string, code: string): Promise<SubmitResult>`; `ordinal(n: number): string` (`1 → "1st"`, `12 → "12th"`).

- [ ] **Step 1: Write the failing ordinal test**

`src/lib/ordinal.test.ts`:

```ts
import { ordinal } from './ordinal'

describe('ordinal', () => {
  it('formats English ordinals', () => {
    expect(ordinal(1)).toBe('1st')
    expect(ordinal(2)).toBe('2nd')
    expect(ordinal(3)).toBe('3rd')
    expect(ordinal(4)).toBe('4th')
    expect(ordinal(11)).toBe('11th')
    expect(ordinal(12)).toBe('12th')
    expect(ordinal(13)).toBe('13th')
    expect(ordinal(21)).toBe('21st')
    expect(ordinal(22)).toBe('22nd')
    expect(ordinal(103)).toBe('103rd')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — cannot resolve `./ordinal`.

- [ ] **Step 3: Implement all three lib files**

`src/lib/ordinal.ts`:

```ts
export function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}
```

`src/lib/supabaseClient.ts`:

```ts
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY environment variables')
}

export const supabase = createClient(url, anonKey)
```

`src/lib/api.ts` (mirrors the jsonb contracts from Tasks 4–5 exactly):

```ts
import { supabase } from './supabaseClient'

export type GameStatus = 'setup' | 'live' | 'paused' | 'ended'

export type TeamView = {
  ok: true
  team_name: string
  game_status: GameStatus
  position: number
  total: number
  clue: string | null
  finished: boolean
  rank: number | null
}

export type LoginResult = { ok: false; error: 'invalid_team_code' } | TeamView

export type SubmitResult =
  | { ok: false; error: 'invalid_team_code' | 'game_not_live' | 'already_finished' }
  | { ok: false; error: 'cooldown'; retry_after_seconds: number }
  | { ok: true; correct: false; reason: 'wrong' | 'already_used' }
  | { ok: true; correct: true; finished: false; position: number; total: number; clue: string }
  | { ok: true; correct: true; finished: true; position: number; total: number; rank: number }

export async function teamLogin(teamCode: string): Promise<LoginResult> {
  const { data, error } = await supabase.rpc('team_login', { p_team_code: teamCode })
  if (error) throw error
  return data as LoginResult
}

export async function submitCode(teamCode: string, code: string): Promise<SubmitResult> {
  const { data, error } = await supabase.rpc('submit_code', { p_team_code: teamCode, p_code: code })
  if (error) throw error
  return data as SubmitResult
}
```

- [ ] **Step 4: Verify tests and build pass**

Run: `npm run test:unit` → PASS. Run: `npm run build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: supabase client, typed player API wrappers and ordinal helper"
```

---

### Task 10: Player app — hook, screens, styles

**Files:**
- Create: `src/player/usePlayerGame.ts`, `src/player/PlayerApp.tsx`, `src/player/LoginScreen.tsx`, `src/player/GameScreen.tsx`, `src/player/WaitingScreen.tsx`, `src/player/FinishedScreen.tsx`
- Modify: `src/index.css` (append player styles)
- Test: `src/player/PlayerApp.test.tsx`

**Interfaces:**
- Consumes: `teamLogin`, `submitCode`, `TeamView`, `GameStatus` (Task 9); `ordinal` (Task 9).
- Produces: `PlayerApp` default-export component (self-contained; no router needed); hook return shape `{ view, restoring, loginError, feedback, busy, login, submit }` with `Feedback = {kind:'wrong'|'already_used'|'correct'} | {kind:'cooldown', seconds:number} | {kind:'error', message:string}`. localStorage key: `treasure_team_code`. Polling: refresh via `team_login` every 30s and on window focus.

- [ ] **Step 1: Write the failing component tests**

`src/player/PlayerApp.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PlayerApp from './PlayerApp'
import * as api from '../lib/api'
import type { TeamView } from '../lib/api'

vi.mock('../lib/api', () => ({
  teamLogin: vi.fn(),
  submitCode: vi.fn(),
}))

const mockedLogin = vi.mocked(api.teamLogin)
const mockedSubmit = vi.mocked(api.submitCode)

function liveView(overrides: Partial<TeamView> = {}): TeamView {
  return {
    ok: true,
    team_name: 'Mongooses',
    game_status: 'live',
    position: 1,
    total: 5,
    clue: 'Look under the big plant',
    finished: false,
    rank: null,
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

async function loginAs(view: TeamView) {
  mockedLogin.mockResolvedValue(view)
  render(<PlayerApp />)
  await userEvent.type(screen.getByLabelText(/team code/i), 'TIGER-42')
  await userEvent.click(screen.getByRole('button', { name: /let's hunt/i }))
}

describe('PlayerApp', () => {
  it('logs a team in and shows their clue and progress', async () => {
    await loginAs(liveView())
    expect(await screen.findByText('Look under the big plant')).toBeInTheDocument()
    expect(screen.getByText(/clue 2 of 5/i)).toBeInTheDocument()
    expect(screen.getByText('Mongooses')).toBeInTheDocument()
    expect(localStorage.getItem('treasure_team_code')).toBe('TIGER-42')
  })

  it('shows an error for a bad team code', async () => {
    mockedLogin.mockResolvedValue({ ok: false, error: 'invalid_team_code' })
    render(<PlayerApp />)
    await userEvent.type(screen.getByLabelText(/team code/i), 'NOPE-00')
    await userEvent.click(screen.getByRole('button', { name: /let's hunt/i }))
    expect(await screen.findByText(/doesn't match any team/i)).toBeInTheDocument()
    expect(localStorage.getItem('treasure_team_code')).toBeNull()
  })

  it('restores a saved session', async () => {
    localStorage.setItem('treasure_team_code', 'TIGER-42')
    mockedLogin.mockResolvedValue(liveView())
    render(<PlayerApp />)
    expect(await screen.findByText('Look under the big plant')).toBeInTheDocument()
    expect(mockedLogin).toHaveBeenCalledWith('TIGER-42')
  })

  it('shows the waiting screen before the hunt starts', async () => {
    await loginAs(liveView({ game_status: 'setup', clue: null }))
    expect(await screen.findByText(/hold tight, mongooses/i)).toBeInTheDocument()
    expect(screen.getByText(/hasn't started yet/i)).toBeInTheDocument()
  })

  it('shows the paused screen', async () => {
    await loginAs(liveView({ game_status: 'paused', clue: null }))
    expect(await screen.findByText(/the hunt is paused/i)).toBeInTheDocument()
  })

  it('rejects a wrong code with a message', async () => {
    await loginAs(liveView())
    mockedSubmit.mockResolvedValue({ ok: true, correct: false, reason: 'wrong' })
    await userEvent.type(await screen.findByLabelText(/enter code/i), 'BAD-99')
    await userEvent.click(screen.getByRole('button', { name: /submit code/i }))
    expect(await screen.findByText(/not the right code/i)).toBeInTheDocument()
  })

  it('nudges when a code was already used', async () => {
    await loginAs(liveView())
    mockedSubmit.mockResolvedValue({ ok: true, correct: false, reason: 'already_used' })
    await userEvent.type(await screen.findByLabelText(/enter code/i), 'OLD-11')
    await userEvent.click(screen.getByRole('button', { name: /submit code/i }))
    expect(await screen.findByText(/already used that code/i)).toBeInTheDocument()
  })

  it('advances to the next clue on a correct code', async () => {
    await loginAs(liveView())
    mockedSubmit.mockResolvedValue({
      ok: true, correct: true, finished: false, position: 2, total: 5, clue: 'Check the coffee machine',
    })
    await userEvent.type(await screen.findByLabelText(/enter code/i), 'TIGER-42')
    await userEvent.click(screen.getByRole('button', { name: /submit code/i }))
    expect(await screen.findByText('Check the coffee machine')).toBeInTheDocument()
    expect(screen.getByText(/clue 3 of 5/i)).toBeInTheDocument()
  })

  it('shows a cooldown countdown and disables submit', async () => {
    await loginAs(liveView())
    mockedSubmit.mockResolvedValue({ ok: false, error: 'cooldown', retry_after_seconds: 4 })
    await userEvent.type(await screen.findByLabelText(/enter code/i), 'TIGER-42')
    await userEvent.click(screen.getByRole('button', { name: /submit code/i }))
    expect(await screen.findByText(/slow down/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /wait/i })).toBeDisabled()
  })

  it('celebrates the treasure with a rank', async () => {
    await loginAs(liveView())
    mockedSubmit.mockResolvedValue({ ok: true, correct: true, finished: true, position: 5, total: 5, rank: 2 })
    await userEvent.type(await screen.findByLabelText(/enter code/i), 'GOLD-01')
    await userEvent.click(screen.getByRole('button', { name: /submit code/i }))
    expect(await screen.findByText(/treasure found!/i)).toBeInTheDocument()
    expect(screen.getByText(/finished 2nd/i)).toBeInTheDocument()
  })

  it('shows the ended screen when the hunt is over', async () => {
    await loginAs(liveView({ game_status: 'ended', clue: null }))
    expect(await screen.findByText(/the hunt is over/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:unit`
Expected: FAIL — cannot resolve `./PlayerApp`.

- [ ] **Step 3: Implement the hook**

`src/player/usePlayerGame.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { teamLogin, submitCode, type TeamView } from '../lib/api'

const STORAGE_KEY = 'treasure_team_code'
const POLL_MS = 30_000

export type Feedback =
  | { kind: 'wrong' }
  | { kind: 'already_used' }
  | { kind: 'correct' }
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
      const result = await teamLogin(code)
      if (result.ok) setView(result)
      else forgetTeam()
    } catch {
      // Network hiccup while polling: keep the current view
    }
  }, [forgetTeam])

  const login = useCallback(async (code: string) => {
    setBusy(true)
    setLoginError(null)
    try {
      const result = await teamLogin(code)
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
    const currentTeamCode = codeRef.current
    if (!currentTeamCode) return
    setBusy(true)
    setFeedback(null)
    try {
      const result = await submitCode(currentTeamCode, code)
      if (!result.ok) {
        if (result.error === 'cooldown') {
          setFeedback({ kind: 'cooldown', seconds: result.retry_after_seconds })
        } else if (result.error === 'invalid_team_code') {
          forgetTeam()
        } else {
          // game_not_live or already_finished: resync the whole view
          await refresh()
        }
      } else if (!result.correct) {
        setFeedback({ kind: result.reason })
      } else {
        setFeedback({ kind: 'correct' })
        setView(v => v && {
          ...v,
          position: result.position,
          total: result.total,
          clue: result.finished ? null : result.clue,
          finished: result.finished,
          rank: result.finished ? result.rank : null,
        })
      }
    } catch {
      setFeedback({ kind: 'error', message: 'Network problem — try again.' })
    } finally {
      setBusy(false)
    }
  }, [forgetTeam, refresh])

  // Restore a saved session on first mount
  useEffect(() => {
    if (!restoring) return
    refresh().finally(() => setRestoring(false))
  }, [restoring, refresh])

  // Poll for admin overrides and game-state changes
  useEffect(() => {
    if (!teamCode) return
    const interval = setInterval(refresh, POLL_MS)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [teamCode, refresh])

  return { view, restoring, loginError, feedback, busy, login, submit }
}
```

- [ ] **Step 4: Implement the screens**

`src/player/PlayerApp.tsx`:

```tsx
import { usePlayerGame } from './usePlayerGame'
import LoginScreen from './LoginScreen'
import GameScreen from './GameScreen'
import WaitingScreen from './WaitingScreen'
import FinishedScreen from './FinishedScreen'

export default function PlayerApp() {
  const game = usePlayerGame()

  if (game.restoring) return <div className="center-screen">Loading…</div>
  if (!game.view) return <LoginScreen onLogin={game.login} error={game.loginError} busy={game.busy} />

  const view = game.view
  if (view.finished) return <FinishedScreen view={view} />
  if (view.game_status !== 'live') return <WaitingScreen status={view.game_status} teamName={view.team_name} />
  return <GameScreen view={view} feedback={game.feedback} busy={game.busy} onSubmit={game.submit} />
}
```

`src/player/LoginScreen.tsx`:

```tsx
import { useState, type FormEvent } from 'react'

type Props = {
  onLogin: (code: string) => void
  error: string | null
  busy: boolean
}

export default function LoginScreen({ onLogin, error, busy }: Props) {
  const [code, setCode] = useState('')

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (code.trim() && !busy) onLogin(code.trim())
  }

  return (
    <div className="player-screen login-screen">
      <h1>🗺️ Office Treasure Hunt</h1>
      <p className="tagline">Crack the clues. Find the codes. Claim the treasure.</p>
      <form onSubmit={handleSubmit} className="code-form">
        <label htmlFor="team-code-input">Team code</label>
        <input
          id="team-code-input"
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder="e.g. MANGO-77"
          autoComplete="off"
          autoCapitalize="characters"
        />
        <button type="submit" disabled={busy || !code.trim()}>Let's hunt!</button>
      </form>
      {error && <p className="msg msg-bad" role="alert">{error}</p>}
    </div>
  )
}
```

`src/player/GameScreen.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from 'react'
import type { TeamView } from '../lib/api'
import type { Feedback } from './usePlayerGame'

type Props = {
  view: TeamView
  feedback: Feedback | null
  busy: boolean
  onSubmit: (code: string) => void
}

export default function GameScreen({ view, feedback, busy, onSubmit }: Props) {
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
    if (cooldown > 0) return { className: 'msg msg-warn', text: `Whoa, slow down! Try again in ${cooldown}s.` }
    if (!feedback) return null
    switch (feedback.kind) {
      case 'wrong':
        return { className: 'msg msg-bad shake', text: "That's not the right code. Keep hunting!" }
      case 'already_used':
        return { className: 'msg msg-warn', text: "You've already used that code — follow your latest clue!" }
      case 'correct':
        return { className: 'msg msg-good', text: 'Code cracked! Here comes your next clue…' }
      case 'error':
        return { className: 'msg msg-bad', text: feedback.message }
      case 'cooldown':
        return null
    }
  })()

  return (
    <div className="player-screen">
      <header className="player-header">
        <span className="team-name">{view.team_name}</span>
        <span className="progress-label">Clue {view.position + 1} of {view.total}</span>
      </header>
      <div className="progress-dots" aria-hidden="true">
        {Array.from({ length: view.total }, (_, i) => (
          <span key={i} className={i < view.position ? 'dot done' : i === view.position ? 'dot current' : 'dot'} />
        ))}
      </div>
      <div className="clue-card" key={view.position}>
        <h2>Your clue</h2>
        <p>{view.clue}</p>
      </div>
      <form onSubmit={handleSubmit} className="code-form">
        <label htmlFor="code-input">Enter code</label>
        <input
          id="code-input"
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder="e.g. TIGER-42"
          autoComplete="off"
          autoCapitalize="characters"
        />
        <button type="submit" disabled={busy || cooldown > 0 || !code.trim()}>
          {cooldown > 0 ? `Wait ${cooldown}s…` : 'Submit code'}
        </button>
      </form>
      {message && <p className={message.className} role="status">{message.text}</p>}
    </div>
  )
}
```

`src/player/WaitingScreen.tsx`:

```tsx
import type { GameStatus } from '../lib/api'

type Props = {
  status: Exclude<GameStatus, 'live'>
  teamName: string
}

export default function WaitingScreen({ status, teamName }: Props) {
  const copy = {
    setup: {
      emoji: '⏳',
      title: `Hold tight, ${teamName}!`,
      body: "The hunt hasn't started yet. Your first clue will appear here the moment it does.",
    },
    paused: {
      emoji: '⏸️',
      title: 'The hunt is paused',
      body: 'Stay where you are — the game master will resume shortly.',
    },
    ended: {
      emoji: '🏁',
      title: 'The hunt is over',
      body: 'Thanks for playing! Gather round for the results.',
    },
  }[status]

  return (
    <div className="player-screen center-screen">
      <div className="big-emoji">{copy.emoji}</div>
      <h1>{copy.title}</h1>
      <p>{copy.body}</p>
    </div>
  )
}
```

`src/player/FinishedScreen.tsx`:

```tsx
import type { TeamView } from '../lib/api'
import { ordinal } from '../lib/ordinal'

export default function FinishedScreen({ view }: { view: TeamView }) {
  return (
    <div className="player-screen center-screen treasure">
      <div className="big-emoji">🏆</div>
      <h1>TREASURE FOUND!</h1>
      <p className="rank-line">
        {view.team_name} finished {view.rank !== null ? ordinal(view.rank) : ''}!
      </p>
      <p>Head back to the game master to celebrate.</p>
    </div>
  )
}
```

- [ ] **Step 5: Append player styles to `src/index.css`**

```css

/* ---------- Player app ---------- */
.player-screen {
  max-width: 430px; margin: 0 auto; min-height: 100dvh;
  padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;
}
.login-screen { justify-content: center; text-align: center; }
.tagline { color: var(--muted); }
.player-header { display: flex; justify-content: space-between; align-items: baseline; }
.team-name { font-weight: 800; color: var(--brand-dark); }
.progress-label { color: var(--muted); font-weight: 600; }
.progress-dots { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.dot { width: 12px; height: 12px; border-radius: 50%; background: var(--line); }
.dot.done { background: var(--good); }
.dot.current { background: var(--brand); animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 50% { transform: scale(1.35); } }
.clue-card {
  background: var(--card); border: 1.5px solid var(--line); border-radius: var(--radius);
  padding: 1.25rem; box-shadow: 0 6px 20px rgb(0 0 0 / 0.06); animation: slide-in 0.35s ease;
}
.clue-card h2 {
  margin: 0 0 0.5rem; font-size: 0.8rem; text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--muted);
}
.clue-card p { margin: 0; font-size: 1.2rem; font-weight: 600; }
@keyframes slide-in { from { opacity: 0; transform: translateY(10px); } }
.code-form input { text-transform: uppercase; font-size: 1.15rem; letter-spacing: 0.05em; text-align: center; }
.code-form button { width: 100%; margin-top: 0.6rem; font-size: 1.05rem; padding: 0.8rem; }
.shake { animation: shake 0.35s ease; }
@keyframes shake {
  20% { transform: translateX(-6px); }
  40% { transform: translateX(6px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(4px); }
}
.big-emoji { font-size: 4rem; }
.treasure h1 { color: var(--brand-dark); font-size: 2.2rem; }
.rank-line { font-size: 1.25rem; font-weight: 700; }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:unit`
Expected: PASS (11 PlayerApp tests + earlier unit tests). Also run `npm run build` → succeeds.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: player app — login, clue/code loop, waiting and treasure screens"
```

### Task 11: App routing, admin shell & login

**Files:**
- Create: `src/admin/AdminApp.tsx`, `src/admin/AdminLogin.tsx`
- Create (stubs, replaced in Tasks 12–16): `src/admin/LiveBoard.tsx`, `src/admin/TeamsPanel.tsx`, `src/admin/StationsPanel.tsx`, `src/admin/GameControl.tsx`, `src/admin/PrintPage.tsx`
- Modify: `src/App.tsx` (real router), `src/index.css` (append admin styles)
- Test: `src/admin/AdminApp.test.tsx`

**Interfaces:**
- Consumes: `supabase` (Task 9), `PlayerApp` (Task 10).
- Produces: routes `/` → PlayerApp, `/admin/*` → AdminApp; AdminApp renders `AdminLogin` when signed out, else a nav (Live board `/admin`, Teams `/admin/teams`, Stations `/admin/stations`, Game control `/admin/control`, Print `/admin/print`, Sign out button) and the tab components. Each stub is `export default function X() { return <p>Coming soon</p> }` until its task replaces it.

- [ ] **Step 1: Write the failing test**

`src/admin/AdminApp.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import AdminApp from './AdminApp'

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
  },
}))

describe('AdminApp', () => {
  it('shows the login gate when signed out', async () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin/*" element={<AdminApp />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText(/game master login/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — cannot resolve `./AdminApp`.

- [ ] **Step 3: Implement AdminLogin, AdminApp, stubs and the router**

`src/admin/AdminLogin.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function AdminLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) setError(signInError.message)
    setBusy(false)
  }

  return (
    <div className="admin-login">
      <form onSubmit={handleSubmit} className="card">
        <h1>Game Master Login</h1>
        <label htmlFor="admin-email">Email</label>
        <input id="admin-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
        <label htmlFor="admin-password">Password</label>
        <input id="admin-password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        <button type="submit" disabled={busy}>Sign in</button>
        {error && <p className="msg msg-bad" role="alert">{error}</p>}
      </form>
    </div>
  )
}
```

`src/admin/AdminApp.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import AdminLogin from './AdminLogin'
import LiveBoard from './LiveBoard'
import TeamsPanel from './TeamsPanel'
import StationsPanel from './StationsPanel'
import GameControl from './GameControl'
import PrintPage from './PrintPage'

export default function AdminApp() {
  const [session, setSession] = useState<Session | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setChecking(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (checking) return null
  if (!session) return <AdminLogin />

  return (
    <div className="admin">
      <nav className="admin-nav">
        <span className="admin-brand">🗺️ Hunt Admin</span>
        <NavLink to="/admin" end>Live board</NavLink>
        <NavLink to="/admin/teams">Teams</NavLink>
        <NavLink to="/admin/stations">Stations</NavLink>
        <NavLink to="/admin/control">Game control</NavLink>
        <NavLink to="/admin/print">Print</NavLink>
        <button className="link-btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </nav>
      <main className="admin-main">
        <Routes>
          <Route index element={<LiveBoard />} />
          <Route path="teams" element={<TeamsPanel />} />
          <Route path="stations" element={<StationsPanel />} />
          <Route path="control" element={<GameControl />} />
          <Route path="print" element={<PrintPage />} />
        </Routes>
      </main>
    </div>
  )
}
```

Each of `src/admin/LiveBoard.tsx`, `src/admin/TeamsPanel.tsx`, `src/admin/StationsPanel.tsx`, `src/admin/GameControl.tsx`, `src/admin/PrintPage.tsx` gets a stub (same shape, different name):

```tsx
export default function LiveBoard() {
  return <p>Coming soon</p>
}
```

`src/App.tsx` (replace the Task 1 placeholder):

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import PlayerApp from './player/PlayerApp'
import AdminApp from './admin/AdminApp'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PlayerApp />} />
        <Route path="/admin/*" element={<AdminApp />} />
      </Routes>
    </BrowserRouter>
  )
}
```

- [ ] **Step 4: Append admin styles to `src/index.css`**

```css

/* ---------- Admin dashboard ---------- */
.admin { min-height: 100dvh; }
.admin-nav {
  display: flex; align-items: center; gap: 1rem; padding: 0.75rem 1.25rem;
  background: #fff; border-bottom: 1px solid var(--line); flex-wrap: wrap;
  position: sticky; top: 0; z-index: 5;
}
.admin-brand { font-weight: 800; margin-right: 0.5rem; }
.admin-nav a {
  color: var(--muted); text-decoration: none; font-weight: 600;
  padding: 0.3rem 0.5rem; border-radius: 8px;
}
.admin-nav a.active { color: var(--brand-dark); background: #f7ead9; }
.admin-nav .link-btn { margin-left: auto; }
.admin-main { padding: 1.25rem; max-width: 1100px; margin: 0 auto; display: grid; gap: 1.25rem; }
.admin-login { display: grid; place-items: center; min-height: 100dvh; padding: 1rem; }
.admin-login .card { width: 100%; max-width: 380px; }
.board-layout { display: grid; grid-template-columns: 2fr 1fr; gap: 1.25rem; align-items: start; }
@media (max-width: 800px) { .board-layout { grid-template-columns: 1fr; } }
.board-table { width: 100%; border-collapse: collapse; margin-top: 0.75rem; }
.board-table th, .board-table td {
  text-align: left; padding: 0.55rem 0.6rem; border-bottom: 1px solid var(--line);
  vertical-align: middle;
}
.board-table th { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.row-finished { background: #fdf6e3; }
.progress-bar {
  background: var(--line); border-radius: 99px; height: 8px; width: 120px;
  display: inline-block; margin-right: 0.5rem; vertical-align: middle; overflow: hidden;
}
.progress-fill { background: var(--good); height: 100%; border-radius: 99px; transition: width 0.4s ease; }
.attempt-feed { list-style: none; margin: 0.5rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.attempt-feed li { display: flex; gap: 0.45rem; align-items: baseline; font-size: 0.92rem; flex-wrap: wrap; }
.attempt-feed time { color: var(--muted); font-size: 0.8rem; margin-left: auto; }
.inline-form { display: flex; gap: 0.6rem; align-items: end; flex-wrap: wrap; }
.inline-form label { margin: 0 0 0.25rem; }
.inline-form input { width: auto; flex: 1; min-width: 200px; }
.btn-row { display: flex; gap: 0.6rem; flex-wrap: wrap; }
.status { text-transform: uppercase; letter-spacing: 0.05em; }
.status-live { color: var(--good); }
.status-paused { color: var(--warn); }
.status-ended { color: var(--bad); }
.status-setup { color: var(--muted); }
.hint { color: var(--muted); font-size: 0.9rem; }
.control-layout { display: grid; gap: 1.25rem; }
```

- [ ] **Step 5: Run tests and build**

Run: `npm run test:unit` → PASS. Run: `npm run build` → succeeds.

- [ ] **Step 6: Smoke-check in the browser**

Run: `npm run dev` — visit `http://localhost:5173/` (player login renders) and `http://localhost:5173/admin` (Game Master Login renders). Create the local admin user so you can sign in during later tasks: open `http://127.0.0.1:54323` (local Supabase Studio) → Authentication → Add user → email `admin@local.dev`, password `local-admin-123`, auto-confirm. Sign in at `/admin` and confirm the nav + "Coming soon" stubs render.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: app routing, admin shell with auth gate and tab navigation"
```

---

### Task 12: Live board with realtime

**Files:**
- Create: `src/admin/adminApi.ts`, `src/admin/sortBoard.ts`, `src/admin/timeAgo.ts`, `src/admin/useAdminBoard.ts`
- Replace: `src/admin/LiveBoard.tsx` (stub → real)
- Test: `src/admin/sortBoard.test.ts`, `src/admin/timeAgo.test.ts`, `src/admin/LiveBoard.test.tsx`

**Interfaces:**
- Consumes: `admin_board` view (Task 8), `supabase` (Task 9), `ordinal` (Task 9).
- Produces (in `adminApi.ts`, grown by later tasks):
  - `type BoardRow = { id: string; name: string; team_code: string; current_position: number; finished_at: string | null; created_at: string; total: number; next_station: string | null; last_solve_at: string | null }`
  - `fetchBoard(): Promise<BoardRow[]>`
  - `type AttemptRow = { id: number; submitted_code: string; result: 'correct' | 'wrong' | 'already_used'; created_at: string; teams: { name: string } | null }`
  - `fetchRecentAttempts(limit?: number): Promise<AttemptRow[]>`
- Produces (own files): `sortBoard(rows: BoardRow[]): BoardRow[]` (finished by finish time, then position desc, then earliest last-solve, then name); `timeAgo(iso: string, now?: number): string` (`"42s ago"`, `"5m ago"`, `"2h ago"`); `useAdminBoard(): { rows, attempts, reload }` (fetches once, refetches on any `postgres_changes` event on `teams`/`attempts`).

- [ ] **Step 1: Write the failing unit tests for the pure helpers**

`src/admin/sortBoard.test.ts`:

```ts
import { sortBoard } from './sortBoard'
import type { BoardRow } from './adminApi'

function row(overrides: Partial<BoardRow>): BoardRow {
  return {
    id: Math.random().toString(36).slice(2),
    name: 'Team',
    team_code: 'X-00',
    current_position: 0,
    finished_at: null,
    created_at: '2026-08-17T09:00:00Z',
    total: 5,
    next_station: null,
    last_solve_at: null,
    ...overrides,
  }
}

describe('sortBoard', () => {
  it('puts finished teams first, ordered by finish time', () => {
    const rows = [
      row({ name: 'SecondFinisher', finished_at: '2026-08-17T10:05:00Z', current_position: 5 }),
      row({ name: 'Hunting', current_position: 3 }),
      row({ name: 'FirstFinisher', finished_at: '2026-08-17T10:01:00Z', current_position: 5 }),
    ]
    expect(sortBoard(rows).map(r => r.name)).toEqual(['FirstFinisher', 'SecondFinisher', 'Hunting'])
  })

  it('ranks unfinished teams by progress, then earliest last solve', () => {
    const rows = [
      row({ name: 'SlowAtThree', current_position: 3, last_solve_at: '2026-08-17T10:10:00Z' }),
      row({ name: 'FastAtThree', current_position: 3, last_solve_at: '2026-08-17T10:02:00Z' }),
      row({ name: 'AtFour', current_position: 4, last_solve_at: '2026-08-17T10:12:00Z' }),
      row({ name: 'NotStarted', current_position: 0 }),
    ]
    expect(sortBoard(rows).map(r => r.name)).toEqual(['AtFour', 'FastAtThree', 'SlowAtThree', 'NotStarted'])
  })

  it('breaks full ties alphabetically and does not mutate the input', () => {
    const rows = [row({ name: 'Zebra' }), row({ name: 'Apple' })]
    const sorted = sortBoard(rows)
    expect(sorted.map(r => r.name)).toEqual(['Apple', 'Zebra'])
    expect(rows.map(r => r.name)).toEqual(['Zebra', 'Apple'])
  })
})
```

`src/admin/timeAgo.test.ts`:

```ts
import { timeAgo } from './timeAgo'

describe('timeAgo', () => {
  const now = new Date('2026-08-17T12:00:00Z').getTime()

  it('formats seconds, minutes and hours', () => {
    expect(timeAgo('2026-08-17T11:59:18Z', now)).toBe('42s ago')
    expect(timeAgo('2026-08-17T11:55:00Z', now)).toBe('5m ago')
    expect(timeAgo('2026-08-17T10:00:00Z', now)).toBe('2h ago')
  })

  it('never goes negative', () => {
    expect(timeAgo('2026-08-17T12:00:05Z', now)).toBe('0s ago')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:unit`
Expected: FAIL — cannot resolve `./sortBoard` / `./timeAgo`.

- [ ] **Step 3: Implement adminApi (board part), sortBoard, timeAgo, useAdminBoard**

`src/admin/adminApi.ts`:

```ts
import { supabase } from '../lib/supabaseClient'

export type BoardRow = {
  id: string
  name: string
  team_code: string
  current_position: number
  finished_at: string | null
  created_at: string
  total: number
  next_station: string | null
  last_solve_at: string | null
}

export async function fetchBoard(): Promise<BoardRow[]> {
  const { data, error } = await supabase.from('admin_board').select('*')
  if (error) throw error
  return data as BoardRow[]
}

export type AttemptRow = {
  id: number
  submitted_code: string
  result: 'correct' | 'wrong' | 'already_used'
  created_at: string
  teams: { name: string } | null
}

export async function fetchRecentAttempts(limit = 20): Promise<AttemptRow[]> {
  const { data, error } = await supabase
    .from('attempts')
    .select('id, submitted_code, result, created_at, teams(name)')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as unknown as AttemptRow[]
}
```

`src/admin/sortBoard.ts`:

```ts
import type { BoardRow } from './adminApi'

export function sortBoard(rows: BoardRow[]): BoardRow[] {
  return [...rows].sort((a, b) => {
    if (a.finished_at && b.finished_at) return a.finished_at < b.finished_at ? -1 : 1
    if (a.finished_at) return -1
    if (b.finished_at) return 1
    if (a.current_position !== b.current_position) return b.current_position - a.current_position
    if (a.last_solve_at && b.last_solve_at && a.last_solve_at !== b.last_solve_at) {
      return a.last_solve_at < b.last_solve_at ? -1 : 1
    }
    if (a.last_solve_at && !b.last_solve_at) return -1
    if (!a.last_solve_at && b.last_solve_at) return 1
    return a.name.localeCompare(b.name)
  })
}
```

`src/admin/timeAgo.ts`:

```ts
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ago`
}
```

`src/admin/useAdminBoard.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchBoard, fetchRecentAttempts, type AttemptRow, type BoardRow } from './adminApi'
import { sortBoard } from './sortBoard'

export function useAdminBoard() {
  const [rows, setRows] = useState<BoardRow[]>([])
  const [attempts, setAttempts] = useState<AttemptRow[]>([])

  const reload = useCallback(async () => {
    const [board, recent] = await Promise.all([fetchBoard(), fetchRecentAttempts()])
    setRows(sortBoard(board))
    setAttempts(recent)
  }, [])

  useEffect(() => {
    reload()
    const channel = supabase
      .channel('admin-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attempts' }, reload)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [reload])

  return { rows, attempts, reload }
}
```

- [ ] **Step 4: Write the failing LiveBoard component test**

`src/admin/LiveBoard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import LiveBoard from './LiveBoard'
import { useAdminBoard } from './useAdminBoard'
import type { BoardRow } from './adminApi'

vi.mock('./useAdminBoard', () => ({ useAdminBoard: vi.fn() }))

function row(overrides: Partial<BoardRow>): BoardRow {
  return {
    id: Math.random().toString(36).slice(2),
    name: 'Team',
    team_code: 'X-00',
    current_position: 0,
    finished_at: null,
    created_at: '2026-08-17T09:00:00Z',
    total: 5,
    next_station: null,
    last_solve_at: null,
    ...overrides,
  }
}

describe('LiveBoard', () => {
  it('renders teams with progress, next station and finish badges', () => {
    vi.mocked(useAdminBoard).mockReturnValue({
      rows: [
        row({ name: 'Winners', current_position: 5, finished_at: '2026-08-17T10:00:00Z' }),
        row({ name: 'Hunters', current_position: 2, next_station: 'Kitchen fridge' }),
      ],
      attempts: [
        {
          id: 1,
          submitted_code: 'BAD-99',
          result: 'wrong',
          created_at: new Date().toISOString(),
          teams: { name: 'Hunters' },
        },
      ],
      reload: vi.fn(),
    })
    render(<LiveBoard />)
    expect(screen.getByText('Winners')).toBeInTheDocument()
    expect(screen.getByText(/finished 1st/i)).toBeInTheDocument()
    expect(screen.getByText('Kitchen fridge')).toBeInTheDocument()
    expect(screen.getByText('2/5')).toBeInTheDocument()
    expect(screen.getByText('BAD-99')).toBeInTheDocument()
  })

  it('shows empty states', () => {
    vi.mocked(useAdminBoard).mockReturnValue({ rows: [], attempts: [], reload: vi.fn() })
    render(<LiveBoard />)
    expect(screen.getByText(/no teams yet/i)).toBeInTheDocument()
    expect(screen.getByText(/no guesses yet/i)).toBeInTheDocument()
  })
})
```

Run: `npm run test:unit` → the LiveBoard tests FAIL (stub renders "Coming soon").

- [ ] **Step 5: Replace the LiveBoard stub**

`src/admin/LiveBoard.tsx`:

```tsx
import { useAdminBoard } from './useAdminBoard'
import { timeAgo } from './timeAgo'
import { ordinal } from '../lib/ordinal'
import type { BoardRow } from './adminApi'

function finishRank(rows: BoardRow[], target: BoardRow): number {
  return rows.filter(r => r.finished_at).findIndex(r => r.id === target.id) + 1
}

const RESULT_ICONS = { correct: '✅', wrong: '❌', already_used: '🔁' } as const

export default function LiveBoard() {
  const { rows, attempts } = useAdminBoard()

  return (
    <div className="board-layout">
      <section className="card">
        <h2>Live board</h2>
        <table className="board-table">
          <thead>
            <tr>
              <th>#</th><th>Team</th><th>Progress</th><th>Next station</th><th>Last solve</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id} className={row.finished_at ? 'row-finished' : ''}>
                <td>{index + 1}</td>
                <td>{row.name}</td>
                <td>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: row.total ? `${(row.current_position / row.total) * 100}%` : '0%' }}
                    />
                  </div>
                  {row.current_position}/{row.total}
                </td>
                <td>{row.finished_at ? '—' : row.next_station ?? 'no route'}</td>
                <td>{row.last_solve_at ? timeAgo(row.last_solve_at) : '—'}</td>
                <td>{row.finished_at ? `🏆 Finished ${ordinal(finishRank(rows, row))}` : 'Hunting'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="empty">No teams yet — add some in the Teams tab.</p>}
      </section>
      <aside className="card">
        <h2>Latest guesses</h2>
        <ul className="attempt-feed">
          {attempts.map(attempt => (
            <li key={attempt.id} className={`attempt-${attempt.result}`}>
              <span>{RESULT_ICONS[attempt.result]}</span>
              <strong>{attempt.teams?.name ?? '?'}</strong> tried <code>{attempt.submitted_code}</code>
              <time>{timeAgo(attempt.created_at)}</time>
            </li>
          ))}
          {attempts.length === 0 && <li className="empty">No guesses yet.</li>}
        </ul>
      </aside>
    </div>
  )
}
```

- [ ] **Step 6: Run tests and build**

Run: `npm run test:unit` → PASS. Run: `npm run build` → succeeds.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: realtime live board with progress ranking and guess feed"
```

### Task 13: Teams panel

**Files:**
- Modify: `src/admin/adminApi.ts` (append team functions)
- Replace: `src/admin/TeamsPanel.tsx` (stub → real)
- Test: `src/admin/TeamsPanel.test.tsx`

**Interfaces:**
- Consumes: `fetchBoard`, `BoardRow`, `sortBoard` (Task 12); `generateCode` (Task 1); `set_team_position` RPC (Task 7).
- Produces (appended to `adminApi.ts`):
  - `createTeam(name: string): Promise<void>` — inserts with an auto-generated team code
  - `updateTeamName(id: string, name: string): Promise<void>`
  - `regenerateTeamCode(id: string): Promise<void>`
  - `deleteTeam(id: string): Promise<void>`
  - `setTeamPosition(teamId: string, position: number): Promise<AdminRpcResult>`
  - `type AdminRpcResult = { ok: boolean; error?: string; [key: string]: unknown }` and internal helper `adminRpc(fn, args?)` (throws on transport error, returns the jsonb payload)

- [ ] **Step 1: Write the failing component tests**

`src/admin/TeamsPanel.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TeamsPanel from './TeamsPanel'
import * as adminApi from './adminApi'
import type { BoardRow } from './adminApi'

vi.mock('./adminApi', () => ({
  fetchBoard: vi.fn(),
  createTeam: vi.fn(),
  updateTeamName: vi.fn(),
  regenerateTeamCode: vi.fn(),
  deleteTeam: vi.fn(),
  setTeamPosition: vi.fn(),
}))

function row(overrides: Partial<BoardRow>): BoardRow {
  return {
    id: 'team-1',
    name: 'Mongooses',
    team_code: 'TIGER-42',
    current_position: 2,
    finished_at: null,
    created_at: '2026-08-17T09:00:00Z',
    total: 5,
    next_station: 'Kitchen',
    last_solve_at: null,
    ...overrides,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('TeamsPanel', () => {
  it('lists teams with codes and progress', async () => {
    vi.mocked(adminApi.fetchBoard).mockResolvedValue([row({})])
    render(<TeamsPanel />)
    expect(await screen.findByText('Mongooses')).toBeInTheDocument()
    expect(screen.getByText('TIGER-42')).toBeInTheDocument()
    expect(screen.getByText('2/5')).toBeInTheDocument()
  })

  it('creates a team and reloads', async () => {
    vi.mocked(adminApi.fetchBoard).mockResolvedValue([])
    vi.mocked(adminApi.createTeam).mockResolvedValue(undefined)
    render(<TeamsPanel />)
    await userEvent.type(await screen.findByLabelText(/new team name/i), 'The Owls')
    await userEvent.click(screen.getByRole('button', { name: /add team/i }))
    await waitFor(() => expect(adminApi.createTeam).toHaveBeenCalledWith('The Owls'))
    expect(vi.mocked(adminApi.fetchBoard).mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('advances and rolls back a team', async () => {
    vi.mocked(adminApi.fetchBoard).mockResolvedValue([row({})])
    vi.mocked(adminApi.setTeamPosition).mockResolvedValue({ ok: true, position: 3 })
    render(<TeamsPanel />)
    await userEvent.click(await screen.findByRole('button', { name: '+1' }))
    expect(adminApi.setTeamPosition).toHaveBeenCalledWith('team-1', 3)
    await userEvent.click(screen.getByRole('button', { name: '-1' }))
    expect(adminApi.setTeamPosition).toHaveBeenCalledWith('team-1', 1)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:unit`
Expected: FAIL — TeamsPanel stub renders "Coming soon"; the mocked `adminApi` factory also fails to resolve missing exports until Step 3 adds them (vi.mock factories don't need the real exports, so the visible failure is the stub rendering).

- [ ] **Step 3: Append team functions to `src/admin/adminApi.ts`**

```ts
import { generateCode } from '../lib/codes'
```

(add to the imports at the top), then append:

```ts
export type AdminRpcResult = { ok: boolean; error?: string; [key: string]: unknown }

async function adminRpc(fn: string, args?: Record<string, unknown>): Promise<AdminRpcResult> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as AdminRpcResult
}

export async function createTeam(name: string): Promise<void> {
  const { error } = await supabase.from('teams').insert({ name, team_code: generateCode() })
  if (error) throw error
}

export async function updateTeamName(id: string, name: string): Promise<void> {
  const { error } = await supabase.from('teams').update({ name }).eq('id', id)
  if (error) throw error
}

export async function regenerateTeamCode(id: string): Promise<void> {
  const { error } = await supabase.from('teams').update({ team_code: generateCode() }).eq('id', id)
  if (error) throw error
}

export async function deleteTeam(id: string): Promise<void> {
  const { error } = await supabase.from('teams').delete().eq('id', id)
  if (error) throw error
}

export function setTeamPosition(teamId: string, position: number): Promise<AdminRpcResult> {
  return adminRpc('set_team_position', { p_team_id: teamId, p_position: position })
}
```

- [ ] **Step 4: Replace the TeamsPanel stub**

`src/admin/TeamsPanel.tsx`:

```tsx
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  createTeam, deleteTeam, fetchBoard, regenerateTeamCode, setTeamPosition, updateTeamName,
  type BoardRow,
} from './adminApi'
import { sortBoard } from './sortBoard'

export default function TeamsPanel() {
  const [teams, setTeams] = useState<BoardRow[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setTeams(sortBoard(await fetchBoard()))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    run(() => createTeam(name.trim()))
    setName('')
  }

  function handleRename(team: BoardRow) {
    const newName = prompt('New team name', team.name)
    if (newName && newName.trim() && newName !== team.name) {
      run(() => updateTeamName(team.id, newName.trim()))
    }
  }

  return (
    <section className="card">
      <h2>Teams</h2>
      <form onSubmit={handleCreate} className="inline-form">
        <div>
          <label htmlFor="new-team-name">New team name</label>
          <input
            id="new-team-name"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="The Mongooses"
          />
        </div>
        <button type="submit">Add team</button>
      </form>
      {error && <p className="msg msg-bad" role="alert">{error}</p>}
      <table className="board-table">
        <thead>
          <tr><th>Team</th><th>Team code</th><th>Progress</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {teams.map(team => (
            <tr key={team.id}>
              <td>
                {team.name}{' '}
                <button className="link-btn" onClick={() => handleRename(team)}>Rename</button>
              </td>
              <td>
                <code>{team.team_code}</code>{' '}
                <button className="link-btn" onClick={() => navigator.clipboard.writeText(team.team_code)}>Copy</button>
                <button className="link-btn" onClick={() => run(() => regenerateTeamCode(team.id))}>New code</button>
              </td>
              <td>{team.current_position}/{team.total}{team.finished_at ? ' 🏆' : ''}</td>
              <td>
                <button
                  onClick={() => run(() => setTeamPosition(team.id, team.current_position - 1))}
                  disabled={team.current_position <= 0}
                >
                  -1
                </button>{' '}
                <button
                  onClick={() => run(() => setTeamPosition(team.id, team.current_position + 1))}
                  disabled={team.total > 0 && team.current_position >= team.total}
                >
                  +1
                </button>{' '}
                <button
                  className="danger"
                  onClick={() => {
                    if (confirm(`Delete team "${team.name}"?`)) run(() => deleteTeam(team.id))
                  }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {teams.length === 0 && <p className="empty">No teams yet.</p>}
    </section>
  )
}
```

- [ ] **Step 5: Run tests and build**

Run: `npm run test:unit` → PASS. Run: `npm run build` → succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: teams panel — CRUD, code management and position overrides"
```

---

### Task 14: Stations panel

**Files:**
- Modify: `src/admin/adminApi.ts` (append station + game-read functions)
- Replace: `src/admin/StationsPanel.tsx` (stub → real)
- Test: `src/admin/StationsPanel.test.tsx`

**Interfaces:**
- Consumes: `generateCode` (Task 1); `GameStatus` (Task 9).
- Produces (appended to `adminApi.ts`):
  - `type StationRow = { id: string; name: string; clue_text: string; code: string; is_final: boolean; sort_order: number }`
  - `fetchStations(): Promise<StationRow[]>` (ordered by `sort_order`)
  - `createStation(input: { name: string; clue_text: string; code: string; sort_order: number }): Promise<void>`
  - `updateStation(id: string, patch: Partial<Pick<StationRow, 'name' | 'clue_text' | 'code' | 'sort_order'>>): Promise<void>`
  - `deleteStation(id: string): Promise<void>`
  - `makeFinal(id: string): Promise<void>` (clears the old final first — required by the partial unique index)
  - `swapOrder(a: StationRow, b: StationRow): Promise<void>`
  - `type GameRow = { id: number; status: GameStatus; started_at: string | null; ended_at: string | null }`
  - `fetchGame(): Promise<GameRow>`

- [ ] **Step 1: Write the failing component tests**

`src/admin/StationsPanel.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StationsPanel from './StationsPanel'
import * as adminApi from './adminApi'
import type { StationRow } from './adminApi'

vi.mock('./adminApi', () => ({
  fetchStations: vi.fn(),
  createStation: vi.fn(),
  updateStation: vi.fn(),
  deleteStation: vi.fn(),
  makeFinal: vi.fn(),
  swapOrder: vi.fn(),
  fetchGame: vi.fn(),
}))

vi.mock('../lib/codes', () => ({ generateCode: () => 'AUTO-11' }))

function station(overrides: Partial<StationRow>): StationRow {
  return {
    id: 'station-1',
    name: 'Kitchen',
    clue_text: 'Where the coffee lives',
    code: 'BEAN-42',
    is_final: false,
    sort_order: 1,
    ...overrides,
  }
}

const setupGame = { id: 1, status: 'setup' as const, started_at: null, ended_at: null }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(adminApi.fetchGame).mockResolvedValue(setupGame)
})

describe('StationsPanel', () => {
  it('lists stations with clues and codes', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([
      station({}),
      station({ id: 'station-2', name: 'Treasure spot', code: 'GOLD-99', is_final: true, sort_order: 2 }),
    ])
    render(<StationsPanel />)
    expect(await screen.findByText('Kitchen')).toBeInTheDocument()
    expect(screen.getByText('Where the coffee lives')).toBeInTheDocument()
    expect(screen.getByText('BEAN-42')).toBeInTheDocument()
    expect(screen.getByText('🏆 Final')).toBeInTheDocument()
  })

  it('creates a station with the generated code', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([])
    vi.mocked(adminApi.createStation).mockResolvedValue(undefined)
    render(<StationsPanel />)
    await userEvent.type(await screen.findByLabelText(/station name/i), 'Reception')
    await userEvent.type(screen.getByLabelText(/clue/i), 'Where visitors wait')
    await userEvent.click(screen.getByRole('button', { name: /add station/i }))
    await waitFor(() =>
      expect(adminApi.createStation).toHaveBeenCalledWith({
        name: 'Reception',
        clue_text: 'Where visitors wait',
        code: 'AUTO-11',
        sort_order: 1,
      }),
    )
  })

  it('warns when the game is running', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([station({})])
    vi.mocked(adminApi.fetchGame).mockResolvedValue({ ...setupGame, status: 'live' })
    render(<StationsPanel />)
    expect(await screen.findByText(/hunt is live/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:unit`
Expected: FAIL — StationsPanel stub renders "Coming soon".

- [ ] **Step 3: Append station + game functions to `src/admin/adminApi.ts`**

```ts
export type StationRow = {
  id: string
  name: string
  clue_text: string
  code: string
  is_final: boolean
  sort_order: number
}

export async function fetchStations(): Promise<StationRow[]> {
  const { data, error } = await supabase
    .from('stations')
    .select('id, name, clue_text, code, is_final, sort_order')
    .order('sort_order')
  if (error) throw error
  return data as StationRow[]
}

export async function createStation(input: {
  name: string
  clue_text: string
  code: string
  sort_order: number
}): Promise<void> {
  const { error } = await supabase.from('stations').insert(input)
  if (error) throw error
}

export async function updateStation(
  id: string,
  patch: Partial<Pick<StationRow, 'name' | 'clue_text' | 'code' | 'sort_order'>>,
): Promise<void> {
  const { error } = await supabase.from('stations').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteStation(id: string): Promise<void> {
  const { error } = await supabase.from('stations').delete().eq('id', id)
  if (error) throw error
}

export async function makeFinal(id: string): Promise<void> {
  const { error: clearError } = await supabase.from('stations').update({ is_final: false }).eq('is_final', true)
  if (clearError) throw clearError
  const { error } = await supabase.from('stations').update({ is_final: true }).eq('id', id)
  if (error) throw error
}

export async function swapOrder(a: StationRow, b: StationRow): Promise<void> {
  const { error: firstError } = await supabase.from('stations').update({ sort_order: b.sort_order }).eq('id', a.id)
  if (firstError) throw firstError
  const { error: secondError } = await supabase.from('stations').update({ sort_order: a.sort_order }).eq('id', b.id)
  if (secondError) throw secondError
}

export type GameRow = {
  id: number
  status: import('../lib/api').GameStatus
  started_at: string | null
  ended_at: string | null
}

export async function fetchGame(): Promise<GameRow> {
  const { data, error } = await supabase.from('game').select('*').single()
  if (error) throw error
  return data as GameRow
}
```

- [ ] **Step 4: Replace the StationsPanel stub**

`src/admin/StationsPanel.tsx`:

```tsx
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  createStation, deleteStation, fetchGame, fetchStations, makeFinal, swapOrder, updateStation,
  type StationRow,
} from './adminApi'
import { generateCode } from '../lib/codes'

type Draft = { name: string; clue_text: string; code: string }

export default function StationsPanel() {
  const [stations, setStations] = useState<StationRow[]>([])
  const [gameRunning, setGameRunning] = useState(false)
  const [name, setName] = useState('')
  const [clue, setClue] = useState('')
  const [code, setCode] = useState(() => generateCode())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>({ name: '', clue_text: '', code: '' })
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [stationRows, game] = await Promise.all([fetchStations(), fetchGame()])
    setStations(stationRows)
    setGameRunning(game.status === 'live' || game.status === 'paused')
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || !clue.trim() || !code.trim()) return
    const nextOrder = stations.length ? Math.max(...stations.map(s => s.sort_order)) + 1 : 1
    run(() =>
      createStation({
        name: name.trim(),
        clue_text: clue.trim(),
        code: code.trim().toUpperCase(),
        sort_order: nextOrder,
      }),
    )
    setName('')
    setClue('')
    setCode(generateCode())
  }

  function startEdit(station: StationRow) {
    setEditingId(station.id)
    setDraft({ name: station.name, clue_text: station.clue_text, code: station.code })
  }

  function saveEdit(id: string) {
    run(() =>
      updateStation(id, {
        name: draft.name.trim(),
        clue_text: draft.clue_text.trim(),
        code: draft.code.trim().toUpperCase(),
      }),
    )
    setEditingId(null)
  }

  return (
    <section className="card">
      <h2>Stations</h2>
      {gameRunning && (
        <p className="msg msg-warn">The hunt is live — editing stations now can confuse teams mid-route.</p>
      )}
      <form onSubmit={handleCreate} className="inline-form">
        <div>
          <label htmlFor="station-name">Station name</label>
          <input id="station-name" value={name} onChange={e => setName(e.target.value)} placeholder="Kitchen fridge" />
        </div>
        <div>
          <label htmlFor="station-clue">Clue leading here</label>
          <input id="station-clue" value={clue} onChange={e => setClue(e.target.value)} placeholder="Where lunches chill…" />
        </div>
        <div>
          <label htmlFor="station-code">Code</label>
          <input id="station-code" value={code} onChange={e => setCode(e.target.value)} />
        </div>
        <button type="submit">Add station</button>
      </form>
      {error && <p className="msg msg-bad" role="alert">{error}</p>}
      <table className="board-table">
        <thead>
          <tr><th>Order</th><th>Station</th><th>Clue</th><th>Code</th><th>Final?</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {stations.map((station, index) => (
            <tr key={station.id}>
              <td>
                {station.sort_order}{' '}
                <button
                  className="link-btn"
                  disabled={index === 0}
                  onClick={() => run(() => swapOrder(station, stations[index - 1]))}
                >
                  ↑
                </button>
                <button
                  className="link-btn"
                  disabled={index === stations.length - 1}
                  onClick={() => run(() => swapOrder(station, stations[index + 1]))}
                >
                  ↓
                </button>
              </td>
              {editingId === station.id ? (
                <>
                  <td><input aria-label="Edit name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></td>
                  <td><input aria-label="Edit clue" value={draft.clue_text} onChange={e => setDraft({ ...draft, clue_text: e.target.value })} /></td>
                  <td><input aria-label="Edit code" value={draft.code} onChange={e => setDraft({ ...draft, code: e.target.value })} /></td>
                  <td>{station.is_final ? '🏆 Final' : ''}</td>
                  <td>
                    <button onClick={() => saveEdit(station.id)}>Save</button>{' '}
                    <button className="link-btn" onClick={() => setEditingId(null)}>Cancel</button>
                  </td>
                </>
              ) : (
                <>
                  <td>{station.name}</td>
                  <td>{station.clue_text}</td>
                  <td><code>{station.code}</code></td>
                  <td>
                    <label style={{ display: 'inline', fontWeight: 400 }}>
                      <input
                        type="radio"
                        name="final-station"
                        checked={station.is_final}
                        onChange={() => run(() => makeFinal(station.id))}
                      />{' '}
                      {station.is_final ? '🏆 Final' : 'Set final'}
                    </label>
                  </td>
                  <td>
                    <button className="link-btn" onClick={() => startEdit(station)}>Edit</button>
                    <button
                      className="danger"
                      onClick={() => {
                        if (confirm(`Delete station "${station.name}"? Team routes that include it must be regenerated.`)) {
                          run(() => deleteStation(station.id))
                        }
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {stations.length === 0 && <p className="empty">No stations yet — add the locations of your hunt.</p>}
    </section>
  )
}
```

- [ ] **Step 5: Run tests and build**

Run: `npm run test:unit` → PASS. Run: `npm run build` → succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: stations panel — CRUD, ordering, final-station selection"
```

### Task 15: Game control panel

**Files:**
- Modify: `src/admin/adminApi.ts` (append lifecycle RPC wrappers + route preview)
- Replace: `src/admin/GameControl.tsx` (stub → real)
- Test: `src/admin/GameControl.test.tsx`

**Interfaces:**
- Consumes: lifecycle RPCs (Task 6), `generate_routes` (Task 7), `fetchGame`/`GameRow` (Task 14), `adminRpc`/`AdminRpcResult` (Task 13).
- Produces (appended to `adminApi.ts`):
  - `startGame(): Promise<AdminRpcResult>`, `pauseGame()`, `resumeGame()`, `endGame()`, `resetProgress()`, `generateRoutes()` — all `() => Promise<AdminRpcResult>` via `adminRpc`
  - `type RoutePreview = { team: string; stops: string[] }`
  - `fetchRoutePreview(): Promise<RoutePreview[]>` (route_stops joined to team and station names, grouped per team in position order, sorted by team name)

- [ ] **Step 1: Write the failing component tests**

`src/admin/GameControl.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import GameControl from './GameControl'
import * as adminApi from './adminApi'

vi.mock('./adminApi', () => ({
  fetchGame: vi.fn(),
  fetchRoutePreview: vi.fn(),
  startGame: vi.fn(),
  pauseGame: vi.fn(),
  resumeGame: vi.fn(),
  endGame: vi.fn(),
  resetProgress: vi.fn(),
  generateRoutes: vi.fn(),
}))

const setupGame = { id: 1, status: 'setup' as const, started_at: null, ended_at: null }

function renderPanel() {
  return render(
    <MemoryRouter>
      <GameControl />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(adminApi.fetchGame).mockResolvedValue(setupGame)
  vi.mocked(adminApi.fetchRoutePreview).mockResolvedValue([])
})

describe('GameControl', () => {
  it('offers Start in setup and surfaces validation errors', async () => {
    vi.mocked(adminApi.startGame).mockResolvedValue({ ok: false, error: 'teams_missing_routes', teams: 2 })
    renderPanel()
    const startButton = await screen.findByRole('button', { name: /start hunt/i })
    await userEvent.click(startButton)
    expect(await screen.findByText(/teams_missing_routes/i)).toBeInTheDocument()
  })

  it('offers Pause and End while live', async () => {
    vi.mocked(adminApi.fetchGame).mockResolvedValue({ ...setupGame, status: 'live' })
    renderPanel()
    expect(await screen.findByRole('button', { name: /pause/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /end hunt/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start hunt/i })).not.toBeInTheDocument()
  })

  it('shows the route preview', async () => {
    vi.mocked(adminApi.fetchRoutePreview).mockResolvedValue([
      { team: 'Mongooses', stops: ['Kitchen', 'Lobby', 'Treasure'] },
    ])
    renderPanel()
    expect(await screen.findByText('Mongooses')).toBeInTheDocument()
    expect(screen.getByText('Kitchen → Lobby → Treasure')).toBeInTheDocument()
  })

  it('generates routes on demand', async () => {
    vi.mocked(adminApi.generateRoutes).mockResolvedValue({ ok: true, teams_routed: 3 })
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /generate routes/i }))
    await waitFor(() => expect(adminApi.generateRoutes).toHaveBeenCalled())
  })

  it('requires typing RESET before resetting', async () => {
    vi.mocked(adminApi.resetProgress).mockResolvedValue({ ok: true, status: 'setup' })
    renderPanel()
    const resetButton = await screen.findByRole('button', { name: /reset progress/i })
    expect(resetButton).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/type reset/i), 'RESET')
    expect(resetButton).toBeEnabled()
    await userEvent.click(resetButton)
    await waitFor(() => expect(adminApi.resetProgress).toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:unit`
Expected: FAIL — GameControl stub renders "Coming soon".

- [ ] **Step 3: Append lifecycle wrappers + route preview to `src/admin/adminApi.ts`**

```ts
export const startGame = (): Promise<AdminRpcResult> => adminRpc('start_game')
export const pauseGame = (): Promise<AdminRpcResult> => adminRpc('pause_game')
export const resumeGame = (): Promise<AdminRpcResult> => adminRpc('resume_game')
export const endGame = (): Promise<AdminRpcResult> => adminRpc('end_game')
export const resetProgress = (): Promise<AdminRpcResult> => adminRpc('reset_progress')
export const generateRoutes = (): Promise<AdminRpcResult> => adminRpc('generate_routes')

export type RoutePreview = { team: string; stops: string[] }

export async function fetchRoutePreview(): Promise<RoutePreview[]> {
  const { data, error } = await supabase
    .from('route_stops')
    .select('team_id, position, teams(name), stations(name)')
    .order('team_id')
    .order('position')
  if (error) throw error
  type Row = { team_id: string; position: number; teams: { name: string } | null; stations: { name: string } | null }
  const byTeam = new Map<string, RoutePreview>()
  for (const row of (data as unknown as Row[]) ?? []) {
    const entry = byTeam.get(row.team_id) ?? { team: row.teams?.name ?? '?', stops: [] }
    entry.stops.push(row.stations?.name ?? '?')
    byTeam.set(row.team_id, entry)
  }
  return [...byTeam.values()].sort((a, b) => a.team.localeCompare(b.team))
}
```

- [ ] **Step 4: Replace the GameControl stub**

`src/admin/GameControl.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  endGame, fetchGame, fetchRoutePreview, generateRoutes, pauseGame, resetProgress, resumeGame, startGame,
  type AdminRpcResult, type GameRow, type RoutePreview,
} from './adminApi'

export default function GameControl() {
  const [game, setGame] = useState<GameRow | null>(null)
  const [preview, setPreview] = useState<RoutePreview[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [resetText, setResetText] = useState('')

  const load = useCallback(async () => {
    const [gameRow, previewRows] = await Promise.all([fetchGame(), fetchRoutePreview()])
    setGame(gameRow)
    setPreview(previewRows)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function run(action: () => Promise<AdminRpcResult>) {
    setMessage(null)
    try {
      const result = await action()
      if (!result.ok) setMessage(`Error: ${result.error}`)
      await load()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }

  if (!game) return null

  return (
    <div className="control-layout">
      <section className="card">
        <h2>
          Game status: <span className={`status status-${game.status}`}>{game.status}</span>
        </h2>
        <div className="btn-row">
          {game.status === 'setup' && <button onClick={() => run(startGame)}>Start hunt</button>}
          {game.status === 'live' && <button onClick={() => run(pauseGame)}>Pause</button>}
          {game.status === 'paused' && <button onClick={() => run(resumeGame)}>Resume</button>}
          {(game.status === 'live' || game.status === 'paused') && (
            <button className="danger" onClick={() => run(endGame)}>End hunt</button>
          )}
        </div>
        {message && <p className="msg msg-bad" role="alert">{message}</p>}
      </section>

      <section className="card">
        <h2>Routes</h2>
        <button onClick={() => run(generateRoutes)}>Generate routes</button>
        <p className="hint">
          In setup this reshuffles every team's route. While the hunt is running it only creates routes for
          teams that don't have one yet.
        </p>
        <table className="board-table">
          <thead>
            <tr><th>Team</th><th>Route</th></tr>
          </thead>
          <tbody>
            {preview.map(route => (
              <tr key={route.team}>
                <td>{route.team}</td>
                <td>{route.stops.join(' → ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {preview.length === 0 && <p className="empty">No routes yet.</p>}
      </section>

      <section className="card">
        <h2>Danger zone</h2>
        <label htmlFor="reset-confirm">Type RESET to clear all progress (teams, stations and routes are kept):</label>
        <input id="reset-confirm" value={resetText} onChange={e => setResetText(e.target.value)} />
        <div className="btn-row" style={{ marginTop: '0.6rem' }}>
          <button
            className="danger"
            disabled={resetText !== 'RESET'}
            onClick={() => {
              run(resetProgress)
              setResetText('')
            }}
          >
            Reset progress
          </button>
        </div>
        <p>
          <Link to="/admin/print">Open print sheets →</Link>
        </p>
      </section>
    </div>
  )
}
```

- [ ] **Step 5: Run tests and build**

Run: `npm run test:unit` → PASS. Run: `npm run build` → succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: game control panel — lifecycle, route generation, guarded reset"
```

---

### Task 16: Print page

**Files:**
- Replace: `src/admin/PrintPage.tsx` (stub → real)
- Modify: `src/index.css` (append print styles)
- Test: `src/admin/PrintPage.test.tsx`

**Interfaces:**
- Consumes: `fetchStations`/`StationRow` (Task 14), `fetchBoard`/`BoardRow` (Task 12).
- Produces: `/admin/print` page rendering one cut-out card per station (code in large type + where to post it) and one slip per team (name + team code + joining instructions), with a Print button; `@media print` hides the admin nav and non-print chrome.

- [ ] **Step 1: Write the failing component test**

`src/admin/PrintPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import PrintPage from './PrintPage'
import * as adminApi from './adminApi'

vi.mock('./adminApi', () => ({
  fetchStations: vi.fn(),
  fetchBoard: vi.fn(),
}))

describe('PrintPage', () => {
  it('renders station cards and team slips', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([
      { id: 's1', name: 'Kitchen', clue_text: 'x', code: 'BEAN-42', is_final: false, sort_order: 1 },
      { id: 's2', name: 'Vault', clue_text: 'y', code: 'GOLD-99', is_final: true, sort_order: 2 },
    ])
    vi.mocked(adminApi.fetchBoard).mockResolvedValue([
      {
        id: 't1', name: 'Mongooses', team_code: 'TIGER-42', current_position: 0,
        finished_at: null, created_at: '2026-08-17T09:00:00Z', total: 0,
        next_station: null, last_solve_at: null,
      },
    ])
    render(<PrintPage />)
    expect(await screen.findByText('BEAN-42')).toBeInTheDocument()
    expect(screen.getByText(/post at: kitchen/i)).toBeInTheDocument()
    expect(screen.getByText(/final treasure/i)).toBeInTheDocument()
    expect(screen.getByText('Mongooses')).toBeInTheDocument()
    expect(screen.getByText('TIGER-42')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — PrintPage stub renders "Coming soon".

- [ ] **Step 3: Replace the PrintPage stub**

`src/admin/PrintPage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { fetchBoard, fetchStations, type BoardRow, type StationRow } from './adminApi'

export default function PrintPage() {
  const [stations, setStations] = useState<StationRow[]>([])
  const [teams, setTeams] = useState<BoardRow[]>([])

  useEffect(() => {
    fetchStations().then(setStations)
    fetchBoard().then(rows => setTeams([...rows].sort((a, b) => a.name.localeCompare(b.name))))
  }, [])

  return (
    <div className="print-page">
      <div className="no-print card">
        <h2>Print sheets</h2>
        <p>Station cards to post at each location, and team slips to hand out. Cut along the dashed lines.</p>
        <button onClick={() => window.print()}>Print</button>
      </div>
      <section className="print-section">
        {stations.map(station => (
          <div className="print-card" key={station.id}>
            <p className="print-eyebrow">
              🗺️ Office Treasure Hunt{station.is_final ? ' · FINAL TREASURE' : ''}
            </p>
            <p className="print-code">{station.code}</p>
            <p className="print-small">Post at: {station.name}</p>
          </div>
        ))}
      </section>
      <section className="print-section">
        {teams.map(team => (
          <div className="print-card" key={team.id}>
            <p className="print-eyebrow">🗺️ Office Treasure Hunt</p>
            <p className="print-team">{team.name}</p>
            <p className="print-code">{team.team_code}</p>
            <p className="print-small">Open the hunt site and enter this team code to begin.</p>
          </div>
        ))}
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Append print styles to `src/index.css`**

```css

/* ---------- Print sheets ---------- */
.print-page { display: grid; gap: 1.25rem; }
.print-section {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1rem;
}
.print-card {
  border: 2px dashed #b8b2a4; border-radius: 12px; padding: 1.25rem;
  text-align: center; background: #fff; break-inside: avoid;
}
.print-eyebrow {
  font-size: 0.8rem; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted); margin: 0;
}
.print-code {
  font-family: ui-monospace, Menlo, monospace; font-size: 2.2rem; font-weight: 800;
  margin: 0.5rem 0; letter-spacing: 0.08em;
}
.print-team { font-size: 1.3rem; font-weight: 700; margin: 0.4rem 0 0; }
.print-small { color: var(--muted); margin: 0; font-size: 0.9rem; }
@media print {
  .admin-nav, .no-print { display: none !important; }
  .admin-main { max-width: none; padding: 0; }
  body { background: #fff; }
  .print-section { grid-template-columns: repeat(2, 1fr); }
}
```

- [ ] **Step 5: Run tests and build**

Run: `npm run test:unit` → PASS. Run: `npm run build` → succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: print sheets for station codes and team slips"
```

---

### Task 17: Deployment config, README & final verification

**Files:**
- Create: `vercel.json`, `README.md`

**Interfaces:**
- Consumes: everything.
- Produces: SPA rewrite config for Vercel; README covering local dev, testing, production deploy and the game-day runbook.

- [ ] **Step 1: Write `vercel.json`**

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

(If deploying to Netlify instead, the equivalent is a `public/_redirects` file containing `/* /index.html 200` — only add it if Netlify is actually chosen.)

- [ ] **Step 2: Write `README.md`**

```markdown
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

`.env.local` points the app at the local stack. If `supabase status` prints
different keys than the ones committed there, update the file.

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
```

- [ ] **Step 3: Full verification**

Run, in order, and confirm all pass:

```bash
supabase db reset
npm test
npm run build
```

Expected: every integration and unit suite green; production build succeeds.

- [ ] **Step 4: Manual end-to-end smoke test**

With `npm run dev` running: in `/admin` create 2 stations + 1 final station, 2 teams, generate routes, start the hunt. In a private window at `/`, log in with a team code from the Teams tab, submit the first station's code (find it on the Print page), confirm the next clue appears and the Live board updates in realtime (no refresh). Finish the route and confirm the TREASURE FOUND screen shows a rank.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: deployment config, README with runbook; final verification"
```

---

## Execution notes

- Tasks must run in order — each consumes interfaces from earlier tasks.
- Backend tasks (2–8) each end with `supabase db reset` + a green `npm run test:integration`; frontend tasks (9–16) each end with a green `npm run test:unit` + `npm run build`.
- The local Supabase stack must be running (`supabase start`) for all integration-test steps.
- If any test fails unexpectedly, use superpowers:systematic-debugging before changing the plan's code.







