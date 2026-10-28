/**
 * Run from the repository root:
 * DAY18_BENCH_DATABASE_URL=postgresql://...@127.0.0.1:5432/cipher_day18_bench \
 *   pnpm --filter @chat-app/api exec tsx ../../perf/postgres-day18.mjs --reset
 *
 * Destructive ONLY to the explicitly named, loopback, disposable database.
 * --baseline-only works before the candidate migration exists.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(
  new URL('../packages/api/package.json', import.meta.url),
);
const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const { migrate } = require('drizzle-orm/node-postgres/migrator');
const root = fileURLToPath(new URL('../', import.meta.url));
const migrationFolder = join(root, 'packages/api/drizzle');
const out = join(root, 'perf/postgres-day18-results');
assert(process.env.DAY18_BENCH_DATABASE_URL, 'Set DAY18_BENCH_DATABASE_URL');
const url = new URL(process.env.DAY18_BENCH_DATABASE_URL);
assert(
  ['postgres:', 'postgresql:'].includes(url.protocol) &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    url.pathname === '/cipher_day18_bench' &&
    !url.search &&
    !url.hash,
  'Only a plain PostgreSQL URL for a loopback cipher_day18_bench database is accepted',
);
assert(process.argv.includes('--reset'), 'Explicit --reset is required');
const baselineOnly = process.argv.includes('--baseline-only');
process.env.DATABASE_URL = url.toString();
const pool = new Pool({ connectionString: url.toString(), max: 1 });
const client = await pool.connect();
let appPool;
const hash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uid = (n) => {
  const hex = createHash('md5').update(`day18:user:${n}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const cid = (n) => {
  const hex = createHash('md5').update(`day18:conversation:${n}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const candidateNames = [
  'conversation_members_user_conversation_idx',
  'users_directory_id_username_idx',
];
const summary = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0],
    median: (sorted[9] + sorted[10]) / 2,
    p95: sorted[18],
    max: sorted.at(-1),
  };
};
const evidence = {
  baseCommit: '607711eefeaf99cdf874e2d71e00e51d8e4ca358',
  seed: 'perf/postgres-day18-seed.sql',
  method: {
    warmupPerCasePerPhase: 5,
    measuredPerCasePerPhase: 20,
    explain: 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)',
    cache: 'Warm-cache, no OS/cache flush; not a cold-start or throughput test',
    concurrency: 1,
    plannerOverrides: 'none; no enable_seqscan/enable_indexscan changes',
    comparisonPlan: [
      'baseline with all existing indexes',
      'candidate via tracked Drizzle migration',
      'baseline-recheck by restoring the original index definitions',
      'candidate-recheck by restoring the migration index definitions',
    ],
    presentation: 'Short performance note with tables and full plan artifacts',
  },
  phases: {},
};

async function saveEvidence() {
  await writeFile(
    join(out, 'evidence.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
}

async function migrateBaseline() {
  const scratch = await mkdtemp(join(tmpdir(), 'cipher-day18-'));
  try {
    const journal = JSON.parse(
      await readFile(join(migrationFolder, 'meta/_journal.json'), 'utf8'),
    );
    journal.entries = journal.entries.filter((entry) => entry.idx <= 5);
    await mkdir(join(scratch, 'meta'));
    await writeFile(
      join(scratch, 'meta/_journal.json'),
      JSON.stringify(journal),
    );
    for (const entry of journal.entries) {
      await writeFile(
        join(scratch, `${entry.tag}.sql`),
        await readFile(join(migrationFolder, `${entry.tag}.sql`)),
      );
    }
    await migrate(drizzle(client), { migrationsFolder: scratch });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function measure(phase, cases) {
  const results = {};
  for (const item of cases) {
    for (let run = 0; run < 5; run += 1) {
      await client.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${item.sql}`,
        item.params,
      );
    }
    results[item.name] = { executionMs: [], planningMs: [] };
  }
  // Round-robin, rotating start positions: no case gets all its samples first.
  for (let run = 0; run < 20; run += 1) {
    for (let offset = 0; offset < cases.length; offset += 1) {
      const item = cases[(run + offset) % cases.length];
      const response = await client.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${item.sql}`,
        item.params,
      );
      const plan = response.rows[0]['QUERY PLAN'][0];
      const result = results[item.name];
      result.executionMs.push(plan['Execution Time']);
      result.planningMs.push(plan['Planning Time']);
      if (run === 0) result.plan = plan;
    }
  }
  for (const item of cases) {
    const result = results[item.name];
    result.timingMs = summary(result.executionMs);
    const rows = (await client.query(item.sql, item.params)).rows;
    const normalized =
      item.kind === 'memberships'
        ? rows.sort((a, b) =>
            a.conversation_id.localeCompare(b.conversation_id),
          )
        : rows;
    result.rowCount = rows.length;
    result.resultHash = hash(normalized);
    assert.equal(
      result.resultHash,
      item.expectedHash,
      `${phase}: ${item.name}`,
    );
  }
  evidence.phases[phase] = results;
  const textPlans = [];
  for (const item of cases) {
    const plan = await client.query(
      `EXPLAIN (ANALYZE, BUFFERS) ${item.sql}`,
      item.params,
    );
    textPlans.push(
      `## ${item.name}\n${plan.rows.map((row) => row['QUERY PLAN']).join('\n')}`,
    );
  }
  await writeFile(
    join(out, `${phase}-plans.txt`),
    textPlans.join('\n\n') + '\n',
  );
  await saveEvidence();
  console.log(
    phase,
    Object.fromEntries(
      Object.entries(results).map(([name, result]) => [name, result.timingMs]),
    ),
  );
}

try {
  await mkdir(out, { recursive: true });
  await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await migrateBaseline();
  await client.query(
    await readFile(join(root, 'perf/postgres-day18-seed.sql'), 'utf8'),
  );
  // Same statistics/visibility preparation for all phases; no DML between them.
  for (const table of ['users', 'conversations', 'conversation_members']) {
    await client.query(`VACUUM (ANALYZE) ${table}`);
  }
  evidence.environment = (
    await client.query(`
    SELECT version() AS postgres, current_setting('shared_buffers') AS shared_buffers,
      current_setting('work_mem') AS work_mem,
      current_setting('random_page_cost') AS random_page_cost,
      current_setting('effective_cache_size') AS effective_cache_size,
      current_setting('jit') AS jit
  `)
  ).rows[0];
  evidence.dataset = (
    await client.query(`
    SELECT (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM conversations) AS conversations,
      (SELECT count(*)::int FROM conversation_members) AS memberships,
      (SELECT count(*)::int FROM messages) AS messages,
      (SELECT count(*)::int FROM users u WHERE NOT EXISTS
        (SELECT 1 FROM conversation_members cm WHERE cm.user_id = u.id)) AS users_without_memberships
  `)
  ).rows[0];
  assert.deepEqual(evidence.dataset, {
    users: 250000,
    conversations: 500000,
    memberships: 1000000,
    messages: 0,
    users_without_memberships: 0,
  });
  assert.equal(
    (
      await client.query(`
    SELECT count(*)::int AS invalid FROM (
      SELECT conversation_id FROM conversation_members GROUP BY conversation_id
      HAVING count(*) <> 2
    ) pairs
  `)
    ).rows[0].invalid,
    0,
  );
  evidence.tableStorage = (
    await client.query(`
    SELECT relname, pg_relation_size(oid)::float8 AS heap_bytes,
      pg_total_relation_size(oid)::float8 AS total_bytes
    FROM pg_class WHERE oid IN ('users'::regclass, 'conversation_members'::regclass)
    ORDER BY relname
  `)
  ).rows;
  evidence.distribution = (
    await client.query(`
    SELECT min(n)::int, max(n)::int,
      percentile_disc(ARRAY[0.5, 0.95, 0.99]) WITHIN GROUP (ORDER BY n) AS p50_p95_p99
    FROM (SELECT u.id, count(cm.id) AS n FROM users u
      LEFT JOIN conversation_members cm ON cm.user_id = u.id GROUP BY u.id) counts
  `)
  ).rows[0];
  evidence.existingIndexes = (
    await client.query(`
    SELECT tablename, indexname, indexdef,
      pg_relation_size(indexname::regclass)::float8 AS bytes
    FROM pg_indexes WHERE schemaname = 'public'
      AND tablename IN ('users', 'conversation_members', 'messages')
    ORDER BY tablename, indexname
  `)
  ).rows;
  const { pool: servicePool } = await import('../packages/api/src/db/index.ts');
  appPool = servicePool;
  const { chatService } = await import(
    '../packages/api/src/modules/chat/chat.service.ts'
  );
  const { userService } = await import(
    '../packages/api/src/modules/user/user.service.ts'
  );
  const { encodeCursor } = await import('../packages/api/src/http/cursor.ts');
  const query = appPool.query.bind(appPool);
  let captured = [];
  appPool.query = (...args) => {
    const config = args[0];
    captured.push({
      sql: typeof config === 'string' ? config : config.text,
      params: args[1] ?? config.values ?? [],
    });
    return query(...args);
  };
  const cases = [];
  for (const [name, number] of [
    ['memberships-hub', 2],
    ['memberships-whale', 1],
    ['memberships-ordinary', 1000],
  ]) {
    captured = [];
    const ids = await chatService.getConversationIds(uid(number));
    assert.equal(captured.length, 1);
    const expected = (
      await client.query(
        'SELECT conversation_id FROM conversation_members WHERE user_id = $1',
        [uid(number)],
      )
    ).rows.sort((a, b) => a.conversation_id.localeCompare(b.conversation_id));
    assert.deepEqual(
      [...ids].sort(),
      expected.map((row) => row.conversation_id).sort(),
    );
    cases.push({
      name,
      kind: 'memberships',
      source:
        'packages/api/src/modules/chat/chat.service.ts#getConversationIds',
      ...captured[0],
      expectedRows: expected.length,
      expectedHash: hash(expected),
    });
  }
  const anchors = (
    await client.query(`
    SELECT id FROM users ORDER BY id OFFSET 125000 LIMIT 1
  `)
  ).rows;
  const deep = (
    await client.query(`
    SELECT id FROM users ORDER BY id OFFSET 240000 LIMIT 1
  `)
  ).rows[0].id;
  for (const [name, anchor] of [
    ['directory-first', undefined],
    ['directory-middle', anchors[0].id],
    ['directory-deep', deep],
  ]) {
    // Exclude an ID that WOULD occur in the page, not a vacuous predicate.
    const exclude = (
      await client.query(
        'SELECT id FROM users WHERE ($1::uuid IS NULL OR id > $1) ORDER BY id OFFSET 5 LIMIT 1',
        [anchor ?? null],
      )
    ).rows[0].id;
    captured = [];
    const page = await userService.listUsers(
      exclude,
      100,
      anchor ? encodeCursor('users', anchor) : undefined,
    );
    assert.equal(captured.length, 1);
    const expected = (
      await client.query(
        'SELECT id, username FROM users WHERE id <> $1 AND ($2::uuid IS NULL OR id > $2) ORDER BY id LIMIT 101',
        [exclude, anchor ?? null],
      )
    ).rows;
    assert.deepEqual(page.items, expected.slice(0, 100));
    assert.equal(page.nextCursor, encodeCursor('users', expected[99].id));
    cases.push({
      name,
      kind: 'directory',
      source: 'packages/api/src/modules/user/user.service.ts#listUsers',
      ...captured[0],
      expectedRows: 101,
      expectedHash: hash(expected),
    });
  }
  async function checkCorrectness() {
    assert.deepEqual(await chatService.getConversationIds(uid(250001)), []);
    for (const item of cases) {
      if (item.kind === 'memberships') {
        const rows = (await chatService.getConversationIds(item.params[0]))
          .map((id) => ({ conversation_id: id }))
          .sort((a, b) => a.conversation_id.localeCompare(b.conversation_id));
        assert.equal(hash(rows), item.expectedHash);
      }
    }
    let cursor;
    const seen = new Set();
    for (let pageNumber = 0; pageNumber < 5; pageNumber += 1) {
      const page = await userService.listUsers(uid(1000), 100, cursor);
      for (const user of page.items) {
        assert.notEqual(user.id, uid(1000));
        assert(!seen.has(user.id));
        if (seen.size) assert(user.id > [...seen].at(-1));
        seen.add(user.id);
      }
      cursor = page.nextCursor;
      assert(cursor);
    }
    const lastIds = (
      await client.query('SELECT id FROM users ORDER BY id DESC LIMIT 10')
    ).rows.map((row) => row.id);
    const tail = await userService.listUsers(
      lastIds[5],
      100,
      encodeCursor('users', lastIds[9]),
    );
    assert.deepEqual(
      tail.items.map((user) => user.id),
      lastIds
        .slice(0, 9)
        .filter((id) => id !== lastIds[5])
        .reverse(),
    );
    assert.equal(tail.nextCursor, null);
    assert.deepEqual(
      await userService.listUsers(
        uid(1000),
        100,
        encodeCursor('users', lastIds[0]),
      ),
      { items: [], nextCursor: null },
    );
    // Authorization and cursor-kind boundaries still run through real services.
    await assert.rejects(
      chatService.getMessages(cid(1), uid(1000), 50),
      (error) => error.code === 'CONVERSATION_NOT_FOUND',
    );
    await assert.rejects(
      userService.listUsers(uid(1000), 100, encodeCursor('messages', cid(1))),
      (error) => error.code === 'INVALID_CURSOR',
    );
    const memberHistory = await chatService.getMessages(cid(1), uid(1), 50);
    assert.deepEqual(memberHistory, { items: [], nextCursor: null });
  }
  evidence.queries = cases;
  await checkCorrectness();
  await measure('baseline', cases); // Persist evidence BEFORE changing indexes.
  if (!baselineOnly) {
    const originalIndex = evidence.existingIndexes.find(
      (index) => index.indexname === 'conversation_members_user_id_idx',
    ).indexdef;
    const migrationStarted = performance.now();
    await migrate(drizzle(client), { migrationsFolder: migrationFolder });
    evidence.migrationWallMs = performance.now() - migrationStarted;
    // Prove the checked-in migration reruns as a no-op via Drizzle's journal.
    await migrate(drizzle(client), { migrationsFolder: migrationFolder });
    const definitions = (
      await client.query(
        'SELECT indexname, indexdef FROM pg_indexes WHERE indexname = ANY($1::text[])',
        [candidateNames],
      )
    ).rows;
    assert.equal(definitions.length, 2);
    evidence.candidateIndexes = (
      await client.query(
        `
      SELECT indexname, indexdef, pg_relation_size(indexname::regclass)::float8 AS bytes
      FROM pg_indexes WHERE indexname = ANY($1::text[]) ORDER BY indexname
    `,
        [candidateNames],
      )
    ).rows;
    await checkCorrectness();
    await measure('candidate', cases);
    for (const name of candidateNames)
      await client.query(`DROP INDEX "${name}"`);
    await client.query(originalIndex);
    await checkCorrectness();
    await measure('baseline-recheck', cases);
    for (const definition of definitions)
      await client.query(definition.indexdef);
    await client.query('DROP INDEX conversation_members_user_id_idx');
    await checkCorrectness();
    await measure('candidate-recheck', cases);
    evidence.correctness = {
      passed: true,
      checks: [
        'Identical ordered directory rows and unordered membership sets in all four phases',
        'Directory self-exclusion within measured pages; exact nextCursor',
        'Five actual service pages strictly ascending with no duplicate IDs',
        'Tail page self-exclusion, null nextCursor, and empty page beyond last ID',
        'Wrong-kind cursor rejected',
        'Non-member history denied; member empty history preserved',
        'Tracked migration applied twice without a second schema change',
      ],
    };
    await saveEvidence();
  }
} finally {
  if (appPool) await appPool.end();
  client.release();
  await pool.end();
}
