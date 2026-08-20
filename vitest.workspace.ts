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
      // These tests share one database and truncate it in beforeEach, so they
      // MUST NOT run concurrently. `fileParallelism: false` is a root-level
      // option that vitest ignores inside a workspace project — it silently did
      // nothing here — so serialize with a single fork instead, which is a
      // per-project option and needs no CLI flag.
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
    },
  },
])
