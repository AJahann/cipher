import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

// NOTE: do not load .env files here — this module is imported by client
// components and is bundled for the browser. Env loading for local dev
// happens in next.config.ts (root .env) and via apps/web/.env.local,
// both of which Next.js inlines into NEXT_PUBLIC_* at build time.
export const env = createEnv({
  client: {
    NEXT_PUBLIC_API_URL: z.url(),
  },
  runtimeEnv: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },
});
