import connectPgSimple from 'connect-pg-simple';
import session from 'express-session';
import { pool } from './index';

const PgSession = connectPgSimple(session);

export const sessionStore = new PgSession({
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
