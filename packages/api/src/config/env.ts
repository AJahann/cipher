import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

for (const envPath of ['../../.env', './.env']) {
  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    // file not found — fall back to process.env
  }
}

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    CLIENT_ORIGIN: z.string().min(1),
    DATABASE_URL: z.string(),
    BACKEND_PORT: z.string(),
    SESSION_SECRET: z.string().min(32),
    REDIS_URL: z
      .url()
      .regex(/^rediss?:\/\//)
      .optional(),
    REDIS_NAMESPACE: z
      .string()
      .regex(/^[\w\-:]{1,64}$/)
      .default('cipher'),
    PRESENCE_LEASE_MS: z.coerce
      .number()
      .int()
      .min(3000)
      .max(60000)
      .default(15000),
    GITHUB_AUTH_ENABLED: z.enum(['true', 'false']).default('false'),
    // Password-only deployments work without OAuth settings. Opt-in plus all
    // three values are required before the UI and routes become available.
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
    GITHUB_REDIRECT_URI: z.url().optional(),
    SENTRY_DSN: z.string().optional(),
    SENTRY_ENVIRONMENT: z.string().optional(),
    SENTRY_RELEASE: z.string().optional(),
    // When set, enables /telemetry/* routes. Requests must present the same
    // value in the `x-telemetry-token` header. When unset, routes stay disabled
    // (404) so production cannot leak telemetry without explicit opt-in.
    TELEMETRY_ADMIN_TOKEN: z.string().min(16).optional(),
    // Separate ingest-only token for public/client telemetry (POST /vitals, POST /spans).
    // Ingest token cannot access admin routes (/dashboard, /data, /clear, /test-error).
    TELEMETRY_INGEST_TOKEN: z.string().min(16).optional(),
  },
  // oxlint-disable-next-line node/no-process-env -- env-core requires the process environment.
  runtimeEnv: process.env,
});
