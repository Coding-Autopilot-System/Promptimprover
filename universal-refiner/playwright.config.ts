import { defineConfig, devices } from '@playwright/test';

const e2ePort = process.env.PROMPT_REFINER_E2E_PORT || '3999';
const e2eBaseUrl = `http://localhost:${e2ePort}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: e2eBaseUrl,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run start',
    url: e2eBaseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 10000,
    env: {
      PROMPT_REFINER_BACKGROUND: 'true',
      PROMPT_REFINER_DASHBOARD_PORT: e2ePort
    }
  },
});
