import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

// Load .env files in local dev. The monorepo root .env is the canonical file;
// an app-local apps/api/.env can override nothing (first-loaded + real env win).
// No-op when the files are absent (CI / production platforms inject real env).
for (const envPath of ['../../../.env', '.env']) {
  try {
    process.loadEnvFile(envPath);
  } catch {
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
    PORT: z.string(),
    SESSION_SECRET: z.string().min(32),
  },
  runtimeEnv: process.env,
});
