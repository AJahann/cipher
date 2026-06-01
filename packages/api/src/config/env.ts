import { config } from 'dotenv';
import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProductionBuild = __dirname.includes(path.join('dist', 'src'));

const envDir = isProductionBuild
  ? path.resolve(__dirname, '../../../') // up out of config, src, and dist
  : path.resolve(__dirname, '../../'); // up out of config and src

config({ path: path.join(envDir, '.env') });

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
