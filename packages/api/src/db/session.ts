import connectPgSimple from 'connect-pg-simple';
import session, { type SessionData } from 'express-session';
import type { PoolClient } from 'pg';
import { pool } from './index';

const PgSession = connectPgSimple(session);
type Callback = (error?: unknown) => void;

/** Serialize saves and revocations for an ID, including across API processes. */
async function withSessionLock(
  id: string,
  action: (client: PoolClient) => Promise<void>,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [id],
    );
    await action(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

class RevocationSafeSessionStore extends PgSession {
  override set(id: string, value: SessionData, callback?: Callback) {
    // Preserve connect-pg-simple's expiry calculation (including its 1-day
    // fallback). Fastify supplies the rolling cookie's 7-day expiry normally.
    const { expires } = value.cookie;
    const expireTime = expires
      ? Math.ceil(new Date(expires).valueOf() / 1000)
      : Math.ceil(Date.now() / 1000 + 86_400);
    void withSessionLock(id, async (client) => {
      await client.query(
        `INSERT INTO user_sessions (sid, sess, expire)
         SELECT $1::varchar, $2::json, to_timestamp($3)
         WHERE NOT EXISTS (SELECT 1 FROM session_revocations WHERE sid = $1)
         ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
        [id, value, expireTime],
      );
    }).then(
      () => callback?.(),
      (error: unknown) => callback?.(error),
    );
  }

  override destroy(id: string, callback?: Callback) {
    void withSessionLock(id, async (client) => {
      // A permanent tombstone prevents stale rolling AND explicit saves from
      // recreating authority. It must not be pruned with expired sessions.
      await client.query(
        'INSERT INTO session_revocations (sid) VALUES ($1) ON CONFLICT DO NOTHING',
        [id],
      );
      await client.query('DELETE FROM user_sessions WHERE sid = $1', [id]);
    }).then(
      () => callback?.(),
      (error: unknown) => callback?.(error),
    );
  }
}

export const sessionStore = new RevocationSafeSessionStore({
  pool,
  tableName: 'user_sessions',
  createTableIfMissing: false,
});

/** Invalidate the previous ID after regeneration, before granting authority. */
export function destroySession(sessionId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sessionStore.destroy(sessionId, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
