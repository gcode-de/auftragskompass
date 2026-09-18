import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.{ts,tsx}'],
      // Process wiring is exercised by Chromium and the real Compose smoke test.
      exclude: [
        'apps/admin/src/main.tsx',
        'apps/api/src/main.ts',
        'apps/worker/src/main.ts',
      ],
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: { lines: 90, branches: 85, functions: 90, statements: 90 },
    },
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['tests/component/**/*.test.tsx'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          hookTimeout: 120000,
          testTimeout: 30000,
          fileParallelism: false,
        },
      },
    ],
  },
});
