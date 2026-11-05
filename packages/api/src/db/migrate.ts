import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './index';

const resolveMigrationsFolder = () => {
  for (const relativePath of ['../../../drizzle', '../../drizzle']) {
    const candidate = fileURLToPath(new URL(relativePath, import.meta.url));
    if (existsSync(`${candidate}/meta/_journal.json`)) return candidate;
  }
  throw new Error('MIGRATIONS_FOLDER_NOT_FOUND');
};

const run = async () => {
  try {
    await migrate(db, { migrationsFolder: resolveMigrationsFolder() });
    console.log('Database migrations applied.');
  } finally {
    await pool.end();
  }
};

run().catch(() => {
  console.error(
    'Database migration failed; inspect deployment configuration and service health.',
  );
  process.exit(1);
});
