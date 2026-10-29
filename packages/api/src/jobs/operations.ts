import type { Pool } from 'pg';

/** Retains prior failure history and queue generations; never re-drives a success. */
export async function redrive(pool: Pool, eventId: string) {
  const result = await pool.query(
    `UPDATE notification_outbox SET status='pending', generation=generation+1, attempts=0,
    next_attempt_at=now(), next_dispatch_at=now(), lease_token=NULL, lease_until=NULL, last_error=NULL, completed_at=NULL
    WHERE id=$1 AND status='failed' RETURNING id, message_id, generation, failures`,
    [eventId],
  );
  if (!result.rowCount) throw new Error('EVENT_NOT_FAILED');
  return result.rows[0];
}
