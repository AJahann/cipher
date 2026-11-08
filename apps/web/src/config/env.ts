import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

for (const envPath of ['../../.env', './.env']) {
  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    // file not found — fall back to process.env
  }
}

export const env = createEnv({
  client: {
    NEXT_PUBLIC_API_URL: z.url(),
    NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: z.string().optional(),
    NEXT_PUBLIC_SENTRY_RELEASE: z.string().optional(),
  },
  runtimeEnv: {
    // oxlint-disable-next-line node/no-process-env -- env-nextjs requires the process environment.
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    // oxlint-disable-next-line node/no-process-env -- env-nextjs requires the process environment.
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    // oxlint-disable-next-line node/no-process-env -- env-nextjs requires the process environment.
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    // oxlint-disable-next-line node/no-process-env -- env-nextjs requires the process environment.
    NEXT_PUBLIC_SENTRY_RELEASE: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  },
});
