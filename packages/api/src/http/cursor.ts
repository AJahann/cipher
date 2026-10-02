import { AppError } from './errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cursors are opaque to clients: base64url(JSON { v, k, id }). `k` names the
 * list the cursor belongs to so a users cursor cannot be replayed against
 * messages. The server resolves `id` to the row's sort key in SQL, so no
 * timestamp precision is lost in transit.
 */
type CursorKind = 'messages' | 'users';

export function encodeCursor(kind: CursorKind, id: string): string {
  return Buffer.from(JSON.stringify({ v: 1, k: kind, id })).toString(
    'base64url',
  );
}

export function decodeCursor(kind: CursorKind, cursor: string): string {
  try {
    const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (raw?.v === 1 && raw.k === kind && typeof raw.id === 'string') {
      if (UUID.test(raw.id)) return raw.id;
    }
  } catch {
    // fall through
  }
  throw new AppError('INVALID_CURSOR');
}
