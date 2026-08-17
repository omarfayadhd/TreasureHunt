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
