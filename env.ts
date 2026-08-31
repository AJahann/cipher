import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env') });

export const env = createEnv({
  server: {
    PLAYWRIGHT_BASE_URL: z.url(),
    CI: z
      .string()
      .transform((v) => v === 'true' || v === '1')
      .optional(),
  },
  runtimeEnv: process.env,
});
