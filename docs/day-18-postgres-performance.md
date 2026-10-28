# Day 18 — PostgreSQL performance

Base: `607711e`. Two existing read paths, no application-query or authorization changes.
The planner naturally selected both covering indexes. This establishes a synthetic,
warm-cache database execution benefit, **not a production latency/throughput claim**.

## Query selection and parameters

1. [`chatService.getConversationIds`](../packages/api/src/modules/chat/chat.service.ts)
   runs during socket bootstrap and presence broadcasts. SQL emitted by the actual
   service:

   ```sql
   SELECT conversation_id FROM conversation_members WHERE user_id = $1;
   ```

   Main parameter: `b960c3c0-d271-66e3-be8b-cf89d7079a9f` (seed user 2); expected **800 conversation
   IDs**, unordered, belonging only to that user. Also measure an ordinary user
   with 2 memberships and a 20,000-membership whale. The unique existing
   `(conversation_id, user_id)` index has the wrong leading column for this lookup;
   the existing `user_id` index filters correctly but must fetch projected IDs
   from the heap.

2. [`userService.listUsers`](../packages/api/src/modules/user/user.service.ts)
   serves the contact directory with cursor pagination:

   ```sql
   SELECT id, username FROM users
   WHERE id <> $1 AND id > $2 ORDER BY id ASC LIMIT $3;
   ```

   Middle-page parameters: excluded/self ID `7fecf512-d360-17b3-3a0f-340e565138fb`;
   cursor ID `7febafb3-99ac-459e-f8da-c44ddfc8605d`; SQL limit **101** for an API page of **100**
   plus one continuation sentinel. Expect ascending IDs above the cursor, no
   self row, and the cursor for the last returned API item. First-page SQL omits
   the cursor predicate; deep-page SQL has the same shape as above. Exact SQL,
   all parameters, row counts, and result hashes are in the evidence file.
   `users_pkey(id)` already filters/orders correctly, but cannot cover username;
   the existing unique username index cannot satisfy ID order.

The message-history `(conversation_id, created_at, id)` index already matches
its filter/order/pagination; it is deliberately unchanged.

## Dataset and method

[Deterministic seed](../perf/postgres-day18-seed.sql): **250,000 users,
500,000 two-person conversations, 1,000,000
memberships**. Membership p50/p95/p99 are 4/5/5;
range 2–20,000. There are no inactive
users in this model and no message rows: these tests cover directory/membership
reads, not message-history or ciphertext storage. UUIDs are deterministic and
scattered relative to heap insertion; usernames are 12 characters. Password fields
are inert, hash-sized filler. No production data or credentials are used.

PostgreSQL 16.15, Linux, shared buffers 128MB, work memory
4MB, random page cost 4.
`VACUUM (ANALYZE)` runs once before the baseline; no data or statistics changes
between phases. For each case/phase: **5 discarded warm-ups, 20 measured
EXPLAIN (ANALYZE, BUFFERS) executions**, one connection, rotated round-robin cases.
The script captures SQL from actual service calls; it does not maintain an
independently optimized SQL copy. No planner scan settings are changed.

Phases: baseline → tracked migration → restored baseline indexes → restored
candidate indexes. Dataset and bound parameters remain identical. Timings are
server execution time, excluding planning, network, ORM mapping, and API work.
Full-precision execution/planning samples and JSON plans are retained; text plans
are additional illustrative executions, not cherry-picked median runs.

## Results

Milliseconds, median / nearest-rank p95; buffers from the first measured JSON plan:

| Path | Before | After | Shared buffer hits before → after |
| --- | ---: | ---: | ---: |
| Q1: 800-conversation hub | 1.0250 / 1.0790 | 0.1325 / 0.1640 | 803 → 9 |
| Q2: middle directory page | 0.1150 / 0.1580 | 0.0410 / 0.0500 | 105 → 4 |

Q1 changed from bitmap heap scan to index-only scan; Q2 from primary-key index
scan to covering index-only scan. Both candidate plans have zero heap fetches
on this vacuumed fixture. Recheck medians: Q1 **1.0240 →
0.1315 ms**; Q2 **0.1150 →
0.0420 ms**.

Ordinary-user membership median: 0.0205 →
0.0170 ms: only microseconds, not a meaningful claimed
user-facing gain. Whale: 4.0875 → 2.9610 ms.
Directory first/deep medians: 0.1160 → 0.0380
ms / 0.1130 → 0.0425 ms. The directory saving
is also sub-millisecond. Write-heavy churn can clear visibility-map bits and
restore heap fetches; this read-mostly synthetic model is favorable to index-only
scans. Validate real traffic/selectivity and write costs before a production rollout.

## Index decisions and deployment cost

[Migration 0006](../packages/api/drizzle/0006_day18_covering_reads.sql), Drizzle
schema, journal, and generated snapshot are committed together:

- Replace `conversation_members_user_id_idx` with
  `(user_id, conversation_id)`: equality filter first; projected ID second.
  No sort or pagination contract is introduced. Keep the existing membership
  uniqueness constraint. Measured B-tree storage: **18.62 → 47.42 MiB**.
- Add `users_directory_id_username_idx(id, username)`: ID range/order first;
  trailing username provides coverage and cannot change unique-ID ordering.
  **11.85 MiB** additional storage. Primary-key/username uniqueness remain.
  Composite keys keep this representable in the current Drizzle index API;
  username is not an additional search/order requirement.

Net measured index increase: **40.65 MiB**, excluding WAL/build
scratch space. Membership inserts/deletes maintain a wider replacement B-tree;
user inserts/deletes and username changes maintain an additional B-tree.
Write throughput/WAL overhead was **not** benchmarked. New indexes are built
before dropping the old narrow index, so peak migration storage is higher.

The migration uses ordinary transactional `CREATE INDEX`, not `CONCURRENTLY`:
it can block writes until commit. Schedule a maintenance window and budget
storage/lock time. A large live deployment needs a separately reviewed,
out-of-transaction concurrent rollout; do not run concurrent DDL inside the
Drizzle transaction or make dashboard-only changes. Roll back through a forward
migration restoring the narrow index and dropping the two candidates, with the
schema updated to match; do not edit migration history.

## Correctness and reproduction

Harness assertions pass in every phase: identical directory row order and
membership sets; self-exclusion; exact continuation cursors; five consecutive
pages without duplicates; tail/empty pages with null cursor; invalid cursor-kind
rejection; denied non-member history; valid member empty history. Migration
rerun is a no-op. **All 180 Vitest tests passed**, including **78 API tests with
real PostgreSQL** for session, OAuth, socket authorization/revocation, and delivery
replay. The **4 benchmark safety tests**, workspace typecheck, production build,
format check, and migration snapshot drift check passed. Browser E2E and
production load/write-throughput tests were not run for this change.

Create a disposable local database, then run from the repository root:

```bash
createdb cipher_day18_bench
DAY18_BENCH_DATABASE_URL=postgresql://localhost/cipher_day18_bench \
  pnpm --filter @chat-app/api exec tsx ../../perf/postgres-day18.mjs --reset
node --test perf/postgres-day18-guard.test.mjs
```

**Destructive only to this dedicated database:** the harness requires a loopback
host, the exact database name, and explicit `--reset`; it recreates its schemas.
It migrates through 0005, seeds, persists baseline evidence, then applies 0006.
It is a manual performance experiment, not an automatic CI timing threshold.

Evidence: [all samples, SQL, settings, sizes, JSON plans and hashes](../perf/postgres-day18-results/evidence.json);
[before plans](../perf/postgres-day18-results/baseline-plans.txt);
[after plans](../perf/postgres-day18-results/candidate-plans.txt);
[baseline recheck](../perf/postgres-day18-results/baseline-recheck-plans.txt);
[candidate recheck](../perf/postgres-day18-results/candidate-recheck-plans.txt).
