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
  },
  runtimeEnv: {
    // oxlint-disable-next-line node/no-process-env -- env-nextjs requires the process environment.
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },
});
