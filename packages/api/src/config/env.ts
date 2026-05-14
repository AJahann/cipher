import { config } from 'dotenv';
import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '../../.env') });

const envSchema = z.object({
  CLIENT_ORIGIN: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string(),
  PORT: z.string().default('3000'),
  SESSION_SECRET: z.string().min(32),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
});

export const env = envSchema.parse(process.env);
