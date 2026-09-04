import { defineConfig, devices } from '@playwright/test';
import { env } from './env';

export default defineConfig({
  testDir: '.',
  testMatch: '**/e2e/**/*.spec.ts',
  testIgnore: ['**/node_modules/**', '**/.next/**', '**/dist/**'],

  fullyParallel: true,
  forbidOnly: env.CI,
  retries: env.CI ? 2 : 0,
  workers: env.CI ? 1 : undefined,

  // Registration generates a keypair in the browser, which is slow enough to
  // blow the 30s default on cold runs.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    env.CI ? ['github'] : ['list'],
  ],

  use: {
    baseURL: env.PLAYWRIGHT_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  webServer: {
    command: 'pnpm dev',
    url: env.PLAYWRIGHT_BASE_URL,
    reuseExistingServer: !env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
