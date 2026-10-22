import { defineConfig, devices } from '@playwright/test';
// AK_E2E_PORT lets a second checkout run its e2e suite while the first one is
// busy on the default port; nothing else changes.
const e2ePort = process.env.AK_E2E_PORT ?? '14873';
const e2eOrigin = `http://127.0.0.1:${e2ePort}`;
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  reporter: 'list',
  use: { baseURL: e2eOrigin, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm --filter @auftragskompass/widget build && pnpm --filter @auftragskompass/admin build && pnpm --filter @auftragskompass/admin preview --host 127.0.0.1 --port ${e2ePort} --strictPort`,
    url: e2eOrigin,
    reuseExistingServer: false,
  },
});
