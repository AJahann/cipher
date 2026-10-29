import 'dotenv/config';
import { z } from 'zod';
import { pool } from '../db';
import { redrive } from './operations';

try {
  const [action, id] = process.argv.slice(2);
  if (action === 'inspect') {
    const result =
      await pool.query(`SELECT id, message_id, status, generation, attempts, last_error, failures, dispatched_at, completed_at
      FROM notification_outbox WHERE status='failed' ORDER BY created_at LIMIT 100`);
    console.log(JSON.stringify(result.rows, null, 2));
  } else if (action === 'redrive') {
    console.log(JSON.stringify(await redrive(pool, z.uuid().parse(id))));
  } else
    throw new Error(
      'USAGE: pnpm --filter @chat-app/api jobs inspect | jobs redrive <failed-event-uuid>',
    );
} catch (_error) {
  console.error(
    'Job operation failed; check arguments, database access and failed event status.',
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
