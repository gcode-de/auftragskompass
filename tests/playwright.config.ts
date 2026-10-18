import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:14873', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      'pnpm --filter @auftragskompass/widget build && pnpm --filter @auftragskompass/admin build && pnpm --filter @auftragskompass/admin preview --host 127.0.0.1 --port 14873 --strictPort',
    url: 'http://127.0.0.1:14873',
    reuseExistingServer: false,
  },
});
