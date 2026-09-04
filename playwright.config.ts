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
    // Runs once before the browser projects. Its own testMatch overrides the
    // top-level `*.spec.ts` glob so only the setup file runs here (and the
    // browser projects, which inherit the glob, never re-run it).
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      dependencies: ['setup'],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      dependencies: ['setup'],
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
