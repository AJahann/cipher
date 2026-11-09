/* oxlint-disable eslint/max-nested-callbacks, eslint/max-lines-per-function */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { instrumentPgPool } from './db-tracer';
import {
  clearRecordedSpans,
  getAllRecordedSpans,
  runWithTraceContext,
} from './tracer';
import type { Pool, PoolClient } from 'pg';

describe('db-tracer pooled client instrumentation and callback lifecycle', () => {
  beforeEach(() => {
    clearRecordedSpans();
  });

  it('sanitizes pooled client query errors using generic message and allowlisted code', async () => {
    const rawError = Object.assign(
      new Error(
        'duplicate key value violates unique constraint on privateKey: my-super-secret-private-key and password: secret-password',
      ),
      { code: '23505' },
    );

    const fakeClient = {
      query: vi.fn().mockRejectedValue(rawError),
    } as unknown as PoolClient;

    const fakePool = {
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue(fakeClient),
    } as unknown as Pool;

    instrumentPgPool(fakePool);

    const client = await fakePool.connect();

    const context = {
      traceId: '11112222333344445555666677778888',
      spanId: '1111222233334444',
      requestId: 'req-db-error-sanitize',
    };

    await expect(
      runWithTraceContext(context, async () => {
        await client.query('INSERT INTO users VALUES ($1)', ['test']);
      }),
    ).rejects.toThrow('duplicate key');

    const spans = getAllRecordedSpans();
    const dbSpan = spans.find((s) => s.kind === 'db');
    expect(dbSpan).toBeDefined();
    expect(dbSpan?.status).toBe('error');
    expect(dbSpan?.errorMessage).toBe('Database query failed (23505)');
    expect(dbSpan?.errorMessage).not.toContain('my-super-secret-private-key');
    expect(dbSpan?.errorMessage).not.toContain('secret-password');
  });

  it('uses generic message without code when code is unallowlisted or absent', async () => {
    const rawError = new Error('unexpected error with sensitive info: foo bar');

    const fakeClient = {
      query: vi.fn().mockRejectedValue(rawError),
    } as unknown as PoolClient;

    const fakePool = {
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue(fakeClient),
    } as unknown as Pool;

    instrumentPgPool(fakePool);
    const client = await fakePool.connect();

    const context = {
      traceId: '22223333444455556666777788889999',
      spanId: '2222333344445555',
      requestId: 'req-db-generic-fallback',
    };

    await expect(
      runWithTraceContext(context, async () => {
        await client.query('SELECT 1');
      }),
    ).rejects.toThrow('unexpected error');

    const dbSpan = getAllRecordedSpans().find((s) => s.kind === 'db');
    expect(dbSpan).toBeDefined();
    expect(dbSpan?.status).toBe('error');
    expect(dbSpan?.errorMessage).toBe('Database query failed');
    expect(dbSpan?.errorMessage).not.toContain('sensitive info');
  });

  it('keeps span open for callback-style client query until callback finishes and sanitizes errors', async () => {
    let capturedCallback: ((err: Error | null, result?: any) => void) | null =
      null;
    const fakeClient = {
      query: vi.fn().mockImplementation((_sql, cb) => {
        capturedCallback = cb;
        return undefined;
      }),
    } as unknown as PoolClient;

    const fakePool = {
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue(fakeClient),
    } as unknown as Pool;

    instrumentPgPool(fakePool);
    const client = await fakePool.connect();

    const context = {
      traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      spanId: 'bbbbbbbbbbbbbbbb',
      requestId: 'req-callback-test',
    };

    runWithTraceContext(context, () => {
      client.query('SELECT * FROM messages', (_err: any, _res: any) => {});
    });

    // BEFORE callback is invoked: span should NOT be recorded as ended yet!
    let spans = getAllRecordedSpans();
    let dbSpan = spans.find((s) => s.kind === 'db');
    expect(dbSpan).toBeUndefined();

    // Now invoke callback with error containing secrets and SQLSTATE syntax error code
    const rawDbError = Object.assign(
      new Error('syntax error at or near ciphertext: raw-leaked-ciphertext'),
      { code: '42601' },
    );
    expect(capturedCallback).toBeTypeOf('function');
    capturedCallback!(rawDbError);

    // AFTER callback is invoked: span should now be ended with sanitized error
    spans = getAllRecordedSpans();
    dbSpan = spans.find((s) => s.kind === 'db');
    expect(dbSpan).toBeDefined();
    expect(dbSpan?.status).toBe('error');
    expect(dbSpan?.errorMessage).toBe('Database query failed (42601)');
    expect(dbSpan?.errorMessage).not.toContain('raw-leaked-ciphertext');
  });

  it('records rowCount and ok status when callback-style client query succeeds', async () => {
    let capturedCallback: ((err: Error | null, result?: any) => void) | null =
      null;
    const fakeClient = {
      query: vi.fn().mockImplementation((_sql, cb) => {
        capturedCallback = cb;
        return undefined;
      }),
    } as unknown as PoolClient;

    const fakePool = {
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue(fakeClient),
    } as unknown as Pool;

    instrumentPgPool(fakePool);
    const client = await fakePool.connect();

    const context = {
      traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      spanId: 'bbbbbbbbbbbbbbbb',
      requestId: 'req-callback-success',
    };

    runWithTraceContext(context, () => {
      client.query('SELECT * FROM users', (_err: any, _res: any) => {});
    });

    expect(getAllRecordedSpans().find((s) => s.kind === 'db')).toBeUndefined();

    capturedCallback!(null, { rows: [{ id: 1 }], rowCount: 1 });

    const dbSpan = getAllRecordedSpans().find((s) => s.kind === 'db');
    expect(dbSpan).toBeDefined();
    expect(dbSpan?.status).toBe('ok');
    expect(dbSpan?.attributes['db.row_count']).toBe(1);
  });
});
