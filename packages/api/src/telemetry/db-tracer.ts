import type { Pool, PoolClient } from 'pg';
import { getTraceContext, startSpan } from './tracer';

const ALLOWED_DB_ERROR_CODES = new Set([
  '23505', // unique_violation
  '23503', // foreign_key_violation
  '23502', // not_null_violation
  '23514', // check_violation
  '42P01', // undefined_table
  '42703', // undefined_column
  '42601', // syntax_error
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '57014', // query_canceled
  '08006', // connection_failure
  '08001', // unable_to_establish_connection
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ECONNRESET',
  'ENOTFOUND',
]);

function spanErrorMessage(err: unknown): string {
  const code = (err as { code?: unknown })?.code;
  if (
    typeof code === 'string' &&
    (ALLOWED_DB_ERROR_CODES.has(code) || /^[0-9A-Z]{5}$/.test(code))
  ) {
    return `Database query failed (${code})`;
  }
  return 'Database query failed';
}

function findTargetTable(text: string, keyword: string): string | undefined {
  const idx = text.search(new RegExp(`\\b${keyword}\\b`, 'i'));
  if (idx === -1) return undefined;
  const after = text.slice(idx + keyword.length).trim();
  return after.split(/[\s"(,]+/)[0]?.toLowerCase();
}

function getOperationVerb(firstWord: string, clean: string): string {
  if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(firstWord)) {
    return firstWord;
  }

  if (firstWord === 'SELECT' || firstWord === 'DELETE') {
    const table = findTargetTable(clean, 'from');
    return table ? `${firstWord} ${table}` : firstWord;
  }

  if (firstWord === 'INSERT') {
    const table = findTargetTable(clean, 'into');
    return table ? `INSERT ${table}` : 'INSERT';
  }

  if (firstWord === 'UPDATE') {
    const table = clean
      .slice(6)
      .trim()
      .split(/[\s"(,]+/)[0]
      ?.toLowerCase();
    return table ? `UPDATE ${table}` : 'UPDATE';
  }

  return clean.slice(0, 32);
}

function extractSqlOperation(query: unknown): string {
  const text =
    typeof query === 'string'
      ? query
      : ((query as { text?: string })?.text ?? '');
  const clean = text.trim();
  if (!clean) return 'QUERY';

  const firstWord = clean.split(/\s+/)[0]?.toUpperCase() ?? '';
  return getOperationVerb(firstWord, clean);
}

// oxlint-disable-next-line @typescript-eslint/no-explicit-any
function executeInstrumentedQuery(
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  originalQuery: (...args: any[]) => any,
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  target: any,
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  args: any[],
) {
  const context = getTraceContext();
  if (!context) {
    return originalQuery.apply(target, args);
  }

  const op = extractSqlOperation(args[0]);
  const span = startSpan(`db.query ${op}`, {
    kind: 'db',
    attributes: {
      'db.system': 'postgresql',
      'db.operation': op,
    },
  });

  const lastArg = args[args.length - 1];
  if (typeof lastArg === 'function') {
    const callbackIndex = args.length - 1;
    const originalCallback = lastArg;
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    args[callbackIndex] = function wrappedCallback(
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      this: any,
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      err: any,
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      res: any,
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      ...cbArgs: any[]
    ) {
      if (err) {
        span.end('error', spanErrorMessage(err));
      } else {
        if (res && typeof res.rowCount === 'number') {
          span.attributes['db.row_count'] = res.rowCount;
        }
        span.end('ok');
      }
      return originalCallback.call(this, err, res, ...cbArgs);
    };

    try {
      return originalQuery.apply(target, args);
    } catch (err) {
      span.end('error', spanErrorMessage(err));
      throw err;
    }
  }

  try {
    const result = originalQuery.apply(target, args);
    if (result && typeof result.then === 'function') {
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      return result.then(
        // oxlint-disable-next-line @typescript-eslint/no-explicit-any
        (res: any) => {
          if (res && typeof res.rowCount === 'number') {
            span.attributes['db.row_count'] = res.rowCount;
          }
          span.end('ok');
          return res;
        },
        // oxlint-disable-next-line @typescript-eslint/no-explicit-any
        (err: any) => {
          span.end('error', spanErrorMessage(err));
          throw err;
        },
      );
    }
    span.end('ok');
    return result;
  } catch (err) {
    span.end('error', spanErrorMessage(err));
    throw err;
  }
}

function wrapClientQuery(client: PoolClient): void {
  const alreadyInstrumented = (
    client as unknown as {
      __cipherTelemetryWrapped?: boolean;
    }
  ).__cipherTelemetryWrapped;
  if (alreadyInstrumented) return;

  const originalClientQuery = client.query.bind(client);
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).query = function query(
    this: PoolClient,
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    ...cArgs: any[]
  ) {
    return executeInstrumentedQuery(originalClientQuery, this, cArgs);
  };
  (
    client as unknown as { __cipherTelemetryWrapped?: boolean }
  ).__cipherTelemetryWrapped = true;
}

export function instrumentPgPool(pool: Pool): void {
  const originalQuery = pool.query.bind(pool);
  const originalConnect = pool.connect.bind(pool);

  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  (pool as any).query = function query(this: Pool, ...args: any[]) {
    return executeInstrumentedQuery(originalQuery, this, args);
  };

  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  (pool as any).connect = function connect(this: Pool, ...args: any[]) {
    const lastArg = args[args.length - 1];
    if (typeof lastArg === 'function') {
      const originalCb = lastArg;
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      args[args.length - 1] = function wrappedConnectCb(
        // oxlint-disable-next-line @typescript-eslint/no-explicit-any
        this: any,
        // oxlint-disable-next-line @typescript-eslint/no-explicit-any
        err: any,
        client: PoolClient,
        // oxlint-disable-next-line @typescript-eslint/no-explicit-any
        release: any,
      ) {
        if (!err && client) {
          wrapClientQuery(client);
        }
        return originalCb.call(this, err, client, release);
      };
      return (originalConnect as any).apply(this, args);
    }

    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    const clientPromise = (originalConnect as any).apply(this, args);
    if (!clientPromise || typeof clientPromise.then !== 'function') {
      return clientPromise;
    }

    return clientPromise.then((client: PoolClient) => {
      wrapClientQuery(client);
      return client;
    });
  };
}
