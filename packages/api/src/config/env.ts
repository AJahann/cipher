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
    CLIENT_ORIGIN: z.url(),
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
  },
  // oxlint-disable-next-line node/no-process-env -- env-core requires the process environment.
  runtimeEnv: process.env,
});
