import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const pool = new Pool({
  // oxlint-disable-next-line node/no-process-env -- the database URL is supplied by the runtime environment.
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });
