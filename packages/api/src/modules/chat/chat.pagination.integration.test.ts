/* oxlint-disable max-lines-per-function, no-await-in-loop, prefer-destructuring, vitest/no-conditional-in-test, eslint/max-nested-callbacks, vitest/prefer-expect-type-of -- Real sequential DB measurements and assertions over committed database effects. */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '../../db/schema';

// oxlint-disable-next-line node/no-process-env -- Explicit disposable PostgreSQL opt-in.
const databaseUrl = process.env.SESSION_TEST_DATABASE_URL;

/**
 * Regression: keyset pagination over `(created_at, id)` must not skip rows
 * when several messages share the same millisecond. Postgres stores
 * microseconds; a JS Date anchor truncates to milliseconds and silently drops
 * rows. The anchor comparison must stay inside SQL.
 */
describe.skipIf(!databaseUrl)(
  'chat history keyset pagination (microsecond ties)',
  () => {
    let db: typeof import('../../db').db;
    let pool: import('pg').Pool;
    let service: typeof import('./chat.service').chatService;

    const runId = randomUUID().slice(0, 8);
    let userA: string;
    let userB: string;
    let conversationId: string;
    const messageIds: string[] = [];

    beforeAll(async () => {
      vi.stubEnv('DATABASE_URL', databaseUrl!);
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('SESSION_SECRET', 'synthetic-pagination-session-signing-key');

      const dbModule = await import('../../db');
      pool = dbModule.pool;
      db = dbModule.db;
      service = (await import('./chat.service')).chatService;

      const migrationsFolder = fileURLToPath(
        new URL('../../../drizzle/', import.meta.url),
      );
      await migrate(drizzle(pool), { migrationsFolder });

      const [a] = await db
        .insert(schema.users)
        .values({
          username: `pag_a_${runId}`,
          passwordHash: 'synthetic',
        })
        .returning();
      const [b] = await db
        .insert(schema.users)
        .values({
          username: `pag_b_${runId}`,
          passwordHash: 'synthetic',
        })
        .returning();
      userA = a!.id;
      userB = b!.id;

      const { conversation } = await service.getOrCreateDirectConversation(
        userA,
        userB,
      );
      conversationId = conversation.id;

      // Three messages inserted normally, then back-dated to the SAME
      // millisecond with distinct microsecond offsets. Any anchor that
      // truncates to milliseconds cannot distinguish m1 from m2.
      const base = Date.UTC(2024, 0, 1, 0, 0, 0, 0); // 2024-01-01T00:00:00.000Z
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
        // 2024-01-01 00:00:00.000000 + i microseconds
        await db.execute(sql`
          update messages
          set created_at = to_timestamp(${base / 1000}) + (${i} * interval '1 microsecond')
          where id = ${message.id}
        `);
      }
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

    it('pages through same-millisecond messages without skipping rows', async () => {
      const seen: string[] = [];
      let cursor: string | undefined;

      for (let page = 0; page < 3; page++) {
        const result = await service.getMessages(
          conversationId,
          userB,
          1,
          cursor,
        );
        expect(result.items).toHaveLength(1);
        seen.push(result.items[0]!.id);
        cursor = result.nextCursor ?? undefined;
      }

      // Newest-first order: m3, m2, m1 — all three rows survive pagination.
      expect(seen).toEqual([...messageIds].reverse());
    });
  },
);
