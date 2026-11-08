import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { instrumentPgPool } from '../telemetry/db-tracer';

export const pool = new Pool({
  // oxlint-disable-next-line node/no-process-env -- the database URL is supplied by the runtime environment.
  connectionString: process.env.DATABASE_URL,
});

instrumentPgPool(pool);

export const db = drizzle(pool, { schema });
