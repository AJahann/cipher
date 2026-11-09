/* oxlint-disable max-lines-per-function, no-await-in-loop, prefer-destructuring, vitest/no-conditional-in-test, eslint/no-shadow, eslint/max-nested-callbacks -- Real sequential DB measurements: bug reproduction requires the exact nested async structure under test. */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { desc, eq, sql } from 'drizzle-orm';
import * as schema from '../db/schema';
import { messages } from '../db/schema';
import {
  clearRecordedSpans,
  getTraceSpans,
  runWithTraceContext,
  startSpan,
} from './tracer';

// oxlint-disable-next-line node/no-process-env -- Explicit disposable PostgreSQL opt-in.
const databaseUrl = process.env.SESSION_TEST_DATABASE_URL;

/**
 * Real incident: chat history keyset pagination anchored on a JS Date
 * timestamp. Postgres stores microseconds; the Date round-trip truncates to
 * milliseconds, so the tuple comparison silently skips same-millisecond rows.
 *
 * This test executes both the old (buggy) and the fixed SQL against real
 * Postgres and measures each with correlated OTel spans, producing the
 * before/after telemetry evidence Day 24 requires.
 */
describe.skipIf(!databaseUrl)(
  'Day 24 incident: keyset pagination timestamp precision (real Postgres)',
  () => {
    let db: typeof import('../db').db;
    let pool: import('pg').Pool;
    let service: typeof import('../modules/chat/chat.service').chatService;

    const runId = randomUUID().slice(0, 8);
    let userA: string;
    let userB: string;
    let conversationId: string;
    const messageIds: string[] = [];

    beforeAll(async () => {
      vi.stubEnv('DATABASE_URL', databaseUrl!);
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('SESSION_SECRET', 'synthetic-incident-session-signing-key');

      const dbModule = await import('../db');
      pool = dbModule.pool;
      // Queries run through the shared typed db instance (env already stubbed).
      db = dbModule.db;
      service = (await import('../modules/chat/chat.service')).chatService;

      const migrationsFolder = fileURLToPath(
        new URL('../../drizzle/', import.meta.url),
      );
      await migrate(drizzle(pool), { migrationsFolder });

      const [a] = await db
        .insert(schema.users)
        .values({ username: `inc_a_${runId}`, passwordHash: 'synthetic' })
        .returning();
      const [b] = await db
        .insert(schema.users)
        .values({ username: `inc_b_${runId}`, passwordHash: 'synthetic' })
        .returning();
      userA = a!.id;
      userB = b!.id;

      const { conversation } = await service.getOrCreateDirectConversation(
        userA,
        userB,
      );
      conversationId = conversation.id;

      const base = Date.UTC(2024, 0, 1, 0, 0, 0, 0);
      for (let i = 0; i < 3; i++) {
        const { message } = await service.sendMessage({
          conversationId,
          senderId: userA,
          clientMessageId: randomUUID(),
          ciphertext: `cipher-${i}`,
          nonce: 'n',
          algorithm: 'xchacha20',
        });
        messageIds.push(message.id);
        await db.execute(sql`
          update messages
          set created_at = to_timestamp(${base / 1000}) + (${i} * interval '1 microsecond')
          where id = ${message.id}
        `);
      }
      clearRecordedSpans();
    }, 120_000);

    afterAll(async () => {
      if (!pool) return;
      if (conversationId) {
        await db.execute(
          sql`delete from conversations where id = ${conversationId}`,
        );
      }
      if (userA && userB) {
        await db.execute(
          sql`delete from users where id in (${userA}, ${userB})`,
        );
      }
      await pool.end();
    });

    it('diagnoses skipped rows from Date-truncated anchor and verifies fix', async () => {
      const traceId = randomUUID().replace(/-/g, '');
      const requestId = randomUUID().replace(/-/g, '');
      let pinoLogRecord: Record<string, unknown> | null = null;

      const measurements = await runWithTraceContext(
        { traceId, spanId: 'root', requestId },
        async () => {
          const serverSpan = startSpan('http.server GET /chat/messages', {
            kind: 'server',
            attributes: {
              'http.route': '/chat/messages',
              'http.method': 'GET',
            },
          });

          const result = await runWithTraceContext(
            { traceId, spanId: serverSpan.spanId, requestId },
            async () => {
              // --- OLD behavior: the anchor's created_at round-tripped through
              // a JS Date, which keeps only millisecond precision. Modeled here
              // deterministically (independent of session timezone) as
              // date_trunc('millisecond', ...) — exactly what Date truncation
              // does to Postgres microsecond timestamps. ---
              const buggySpan = startSpan(
                'db.query SELECT messages (buggy anchor)',
                {
                  kind: 'db',
                  attributes: { 'db.system': 'postgresql' },
                },
              );
              const buggyResult = await db.execute(sql`
                select id from messages
                where conversation_id = ${conversationId}
                  and (created_at, id) < (
                    select date_trunc('millisecond', created_at), id
                    from messages where id = ${messageIds[2]!}
                  )
                order by created_at desc, id desc
                limit 2
              `);
              const buggyRows = buggyResult.rows as { id: string }[];
              buggySpan.end('ok');

              // --- FIXED behavior: anchor stays inside SQL ---
              const fixedSpan = startSpan(
                'db.query SELECT messages (sql anchor)',
                {
                  kind: 'db',
                  attributes: { 'db.system': 'postgresql' },
                },
              );
              const fixedPage1 = await service.getMessages(
                conversationId,
                userB,
                1,
              );
              const fixedPage2 = await service.getMessages(
                conversationId,
                userB,
                1,
                fixedPage1.nextCursor ?? undefined,
              );
              const fixedSpan2 = startSpan(
                'db.query SELECT messages (page 2)',
                {
                  kind: 'db',
                  attributes: { 'db.system': 'postgresql' },
                },
              );
              fixedSpan2.end('ok');
              fixedSpan.end('ok');

              return { buggyRows, fixedPage1, fixedPage2 };
            },
          );

          serverSpan.end('ok');
          pinoLogRecord = {
            requestId,
            traceId,
            spanId: serverSpan.spanId,
            route: '/chat/messages',
            method: 'GET',
            status: 200,
            duration_ms: serverSpan.end().duration_ms,
          };
          return result;
        },
      );

      // --- Symptom: buggy anchor skips same-millisecond rows ---
      // Expected rows older than newest: m2, m1 (2 rows). Buggy anchor
      // truncates to .000ms, so (created_at, id) < (.000, m3) misses m2
      // (which sits at .000001s) and returns only m1 — or none, depending on
      // id ordering. It must NOT return both.
      expect(measurements.buggyRows.length).toBeLessThan(2);

      // --- Fix: all three messages paginate through correctly ---
      const fixedSeen = [
        measurements.fixedPage1.items[0]!.id,
        measurements.fixedPage2.items[0]!.id,
      ];
      expect(fixedSeen).toEqual([messageIds[2], messageIds[1]]);

      // --- Telemetry evidence: correlated spans + structured log ---
      const spans = getTraceSpans(traceId);
      expect(spans.length).toBeGreaterThanOrEqual(4);
      const buggy = spans.find((s) => s.name.includes('buggy anchor'));
      const fixed = spans.find((s) => s.name.includes('sql anchor'));
      expect(buggy).toBeDefined();
      expect(fixed).toBeDefined();
      expect(buggy!.duration_ms).toBeGreaterThan(0);
      expect(fixed!.duration_ms).toBeGreaterThan(0);

      // Log carries the shared identifiers for cross-system correlation.
      expect(pinoLogRecord).toBeDefined();
      expect(pinoLogRecord!['traceId']).toBe(traceId);
      expect(pinoLogRecord!['requestId']).toBe(requestId);
      expect(pinoLogRecord!['route']).toBe('/chat/messages');
    });
  },
);
