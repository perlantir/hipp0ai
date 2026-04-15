import { defineConfig, devices } from '@playwright/test';

const DASHBOARD_URL = process.env.DASHBOARD_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: DASHBOARD_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.E2E_AUTO_START_DASHBOARD === '1' ? {
    command: 'cd ../.. && pnpm --filter @hipp0/dashboard dev -- --port 5173',
    url: DASHBOARD_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  } : undefined,
});
