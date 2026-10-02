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

function parseCursor(cursor: string): unknown {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch (error) {
    // Not base64url JSON: treated exactly like any other invalid cursor.
    return { invalid: error };
  }
}

export function decodeCursor(kind: CursorKind, cursor: string): string {
  const raw = parseCursor(cursor) as { v?: unknown; k?: unknown; id?: unknown };
  if (
    raw?.v === 1 &&
    raw.k === kind &&
    typeof raw.id === 'string' &&
    UUID.test(raw.id)
  ) {
    return raw.id;
  }
  throw new AppError('INVALID_CURSOR');
}
