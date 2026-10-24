import { defineConfig, devices } from '@playwright/test';
import { env } from './env';

const webServer = env.CI
  ? [
      {
        command:
          'packages/api/node_modules/.bin/tsx packages/api/src/server.ts',
        url: new URL('/health', env.NEXT_PUBLIC_API_URL).toString(),
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: 'pipe' as const,
        stderr: 'pipe' as const,
      },
      {
        command: 'cd apps/web && node_modules/.bin/next start',
        url: env.PLAYWRIGHT_BASE_URL,
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: 'pipe' as const,
        stderr: 'pipe' as const,
      },
    ]
  : {
      command: 'pnpm dev',
      url: env.PLAYWRIGHT_BASE_URL,
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: 'pipe' as const,
      stderr: 'pipe' as const,
    };

export default defineConfig({
  testDir: '.',
  testMatch: '**/e2e/**/*.spec.ts',
  testIgnore: ['**/node_modules/**', '**/.next/**', '**/dist/**'],

  metadata: { apiURL: env.NEXT_PUBLIC_API_URL },

  fullyParallel: true,
  forbidOnly: env.CI,
  retries: env.CI ? 2 : 0,
  workers: env.CI ? 1 : 2,
  failOnFlakyTests: env.CI,

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
    // Passing attempts do not encode video. First retry retains video + trace.
    video: 'on-first-retry',
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

  webServer,
});
