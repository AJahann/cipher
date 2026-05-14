import connectPgSimple from 'connect-pg-simple';
import session from 'express-session';
import { pool } from './index';

const PgSession = connectPgSimple(session);

export const sessionStore = new PgSession({
  pool,
  tableName: 'user_sessions',
  createTableIfMissing: true,
});
