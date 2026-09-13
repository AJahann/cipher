import type { Pool, PoolClient } from 'pg';
import { getTraceContext, startSpan } from './tracer';

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

export function instrumentPgPool(pool: Pool): void {
  const originalQuery = pool.query.bind(pool);
  const originalConnect = pool.connect.bind(pool);

  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  (pool as any).query = function query(this: Pool, ...args: any[]) {
    const context = getTraceContext();
    if (!context) {
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      return (originalQuery as any).apply(this, args);
    }

    const op = extractSqlOperation(args[0]);
    const span = startSpan(`db.query ${op}`, {
      kind: 'db',
      attributes: {
        'db.system': 'postgresql',
        'db.operation': op,
      },
    });

    try {
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (originalQuery as any).apply(this, args);
      if (result && typeof result.then === 'function') {
        // oxlint-disable-next-line @typescript-eslint/no-explicit-any
        return result.then(
          (res: any) => {
            if (res && typeof res.rowCount === 'number') {
              span.attributes['db.row_count'] = res.rowCount;
            }
            span.end('ok');
            return res;
          },
          (err: any) => {
            span.end('error', err instanceof Error ? err.message : String(err));
            throw err;
          },
        );
      }
      span.end('ok');
      return result;
    } catch (err) {
      span.end('error', err instanceof Error ? err.message : String(err));
      throw err;
    }
  };

  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  (pool as any).connect = function connect(this: Pool, ...args: any[]) {
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    const clientPromise = (originalConnect as any).apply(this, args);
    if (!clientPromise || typeof clientPromise.then !== 'function') {
      return clientPromise;
    }

    return clientPromise.then((client: PoolClient) => {
      // Instrument the acquired client for transaction queries
      const originalClientQuery = client.query.bind(client);
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).query = function query(
        this: PoolClient,
        ...cArgs: any[]
      ) {
        const context = getTraceContext();
        if (!context) {
          // oxlint-disable-next-line @typescript-eslint/no-explicit-any
          return (originalClientQuery as any).apply(this, cArgs);
        }

        const op = extractSqlOperation(cArgs[0]);
        const span = startSpan(`db.query ${op}`, {
          kind: 'db',
          attributes: {
            'db.system': 'postgresql',
            'db.operation': op,
          },
        });

        try {
          // oxlint-disable-next-line @typescript-eslint/no-explicit-any
          const result = (originalClientQuery as any).apply(this, cArgs);
          if (result && typeof result.then === 'function') {
            // oxlint-disable-next-line @typescript-eslint/no-explicit-any
            return result.then(
              (res: any) => {
                if (res && typeof res.rowCount === 'number') {
                  span.attributes['db.row_count'] = res.rowCount;
                }
                span.end('ok');
                return res;
              },
              (err: any) => {
                span.end(
                  'error',
                  err instanceof Error ? err.message : String(err),
                );
                throw err;
              },
            );
          }
          span.end('ok');
          return result;
        } catch (err) {
          span.end('error', err instanceof Error ? err.message : String(err));
          throw err;
        }
      };
      return client;
    });
  };
}
