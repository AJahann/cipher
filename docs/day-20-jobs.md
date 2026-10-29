# Day 20 — accepting work is not completing it

Base: `6d9882a` (Day 19 merged). One real asynchronous job: message notification.
No separate delivery bridge, durable peer-delivery receipt, or background crypto.

Apply `0007_notification_outbox` before starting the new API; stop/drain old API
binaries first. Old binaries do not write notification intent atomically.

## Acceptance boundary

`message:send` checks the PostgreSQL session, validates the shared command schema,
and authorizes conversation membership before acceptance. `chatService.sendMessage`
now commits **message + notification_outbox intent in one PostgreSQL transaction**.
If either insert fails, both roll back. Only then does `ok: true` / `message:ack`
mean **durable acceptance**, not notification completion, peer delivery, or read.
Redis and peer availability are not on this acknowledgement path.

The permanent `(sender_id, client_message_id)` message constraint and existing
payload comparison remain authoritative. Concurrent matching replays return the
same stored message; conflicting conversation/ciphertext/nonce/algorithm rejects.
The unique outbox `message_id` permits one logical notification intent. Replays
never insert another intent or reset a completed/failed one. Do not use a new
client command ID just because notification is delayed. History remains the
recipient's recovery source. The migration creates completed `LEGACY_NO_DISPATCH`
tombstones for pre-existing messages, without blasting old history to sockets.

## Topology, identities, and bounds

- **ONE messenger API process** owns Socket.IO, the dispatcher, and the BullMQ
  consumer. The consumer closes over that API's actual `io`; there is no standalone
  production worker pretending to access another process's in-memory sockets.
  Day 19 presence remains cross-instance, but this does **not** make message
  transport horizontally safe. Multiple API consumers may consume a hint on the
  wrong process. Keep the supported single-API deployment boundary.
- SQL event identity: `notification_outbox.id`; unique message reference.
  Queue payload: `{eventId,generation}` only. No credentials, keys, session IDs,
  or ciphertext copies. Job ID: `<event-uuid>-g<generation>`; queue:
  `<REDIS_NAMESPACE>:jobs:v1:message-notification` (BullMQ-managed suffixes).
- Dispatcher ticks every second, serializes its own runs, and selects at most
  **25** due intents. After enqueue it records a dispatch marker and a **30 s**
  reconciliation deadline. A dispatch marker is not completion and never deletes
  an intent. Retained matching jobs deduplicate enqueue retries.
- Worker concurrency is **4**. A SQL token lease lasts **30 s**, refreshed every
  **10 s**. Generation/token checks fence completion/failure updates from old
  owners. BullMQ also renews its own 30 s active-job lock and handles stalls.
- SQL permits **3 claimed side-effect attempts per generation**. Throwing attempts
  retry with exponential **1 s, 2 s** backoff; BullMQ also has three attempts and
  at most two stalled recoveries. SQL retains the count if Redis forgets it.
  Redis retry metadata is not the message-command idempotency boundary.

Pre-claim infrastructure failures/lease contention can exhaust a BullMQ job
without consuming a SQL side-effect attempt. The reconciler may re-enqueue that
same logical event after connectivity/lease recovery. This is not permission for
unlimited poison-message effects: the durable three-claim cap still applies.
An expired third claim is made terminal by the bounded dispatcher, rather than
silently retried forever. Hanging infrastructure calls require an operator restart;
this implementation does not claim a hard end-to-end execution-time deadline.

The consumer loads the authoritative message/sender and current conversation
members, then checks each local socket's PostgreSQL session immediately before
emitting. Redis presence and old conversation rooms are not receive authority.
Session checks and network emission cannot form an atomic transaction. A tiny
in-flight revocation race remains; durable session authority and idle checks stay.
Successful completion means the local notification routine returned, including
when no peer is online. It is never evidence of receipt/read.

## Crash windows and Redis assumptions

1. **Commit before enqueue:** SQL pending intent survives API/dispatcher downtime.
2. **Enqueue before dispatch marker:** reconciliation reuses the stable job ID.
3. **Socket effect before SQL completion:** a recovered attempt may emit again.
   Clients deduplicate by persisted message ID and reconcile paged history. Neither
   a second job execution nor command replay creates another message row.
4. **SQL completion before queue completion:** reprocessing sees completed SQL and
   does not repeat the effect. Old generation jobs cannot override a re-drive.

Queue connections are separate from Day 19's cache runtime. The producer has a
1 s command timeout, one request retry and no offline command queue. Blocking
workers have **no request command timeout**, `maxRetriesPerRequest: null`, and
background reconnect backoff (250 ms increasing to 2 s); they do not inherit the
cache's 150 ms command policy. Acceptance continues through PostgreSQL while
Redis is down or unconfigured; live notification waits for configured Redis and
recovery. The health endpoint is not a queue-readiness check.

Use Redis **6.2+**, private/ACL-protected networking/TLS, persistence appropriate
to the deployment (e.g. AOF), and **noeviction**. Namespace separation is not
resource/security isolation. If sharing Redis with cache/presence, noeviction can
reject new cache writes; their existing fallback still applies. Monitor memory,
queue backlog and SQL pending age. PostgreSQL persistence/backups are essential.
Even if already-dispatched queue data is lost, retained pending SQL intents are
reconciled after their lease/30 s deadline. Completed SQL intents are not re-sent;
clients recover missed notifications through history/reconnect. This is not
exactly-once network delivery or a guarantee against losing both databases.

## Retained failures and safe re-drive

Exhausted intents remain `failed`, with event/message IDs, generation, attempt
count, a fixed sanitized reason, and append-only terminal `failures` history.
Exhausted BullMQ jobs are retained too; the worker only records fixed errors,
never arbitrary exception text. Completed/failed jobs are not auto-removed.

Use a trusted operator shell with an explicitly supplied database URL; no public
admin route or client credential grants re-drive authority:

```bash
DATABASE_URL=postgresql://localhost/cipher_test pnpm --filter @chat-app/api jobs inspect
# Fix the underlying cause first, then use the SQL event UUID, not message UUID:
DATABASE_URL=postgresql://localhost/cipher_test pnpm --filter @chat-app/api jobs redrive EVENT_UUID
```

Re-drive atomically accepts **failed only**, increments generation, resets the
three-attempt budget, and preserves prior failure history/the old failed job.
Two concurrent re-drives cannot both succeed. The running API's next dispatcher
pass picks up the new stable generation ID. Inspect SQL after re-drive; do not
infer receipt from a completed job. Diagnose stalled infrastructure separately:

```sql
SELECT status, count(*), min(created_at) AS oldest
FROM notification_outbox GROUP BY status;
SELECT id, message_id, attempts, lease_until, next_dispatch_at
FROM notification_outbox WHERE status='pending' ORDER BY created_at LIMIT 100;
```

Storage cost is one indexed SQL intent per message (including migration
backfill), retained BullMQ job records, and failure history per manual re-drive.
Plan storage/backups and an explicit retention policy. Completed Redis jobs may
be pruned in bounded batches after verifying SQL completion; never purge pending
SQL intents or unresolved failed records as a queue-space workaround. SQL state,
not Redis job retention, prevents a completed event from being dispatched again.

## Reproduction and evidence

Use disposable PostgreSQL 16 and loopback Redis database **15**, not production.
The test uses a unique namespace, cleans only its records/keys, and routes child
API Redis connections through a transparent fault-injection TCP proxy.

```bash
pnpm install --frozen-lockfile
SESSION_TEST_DATABASE_URL=postgresql://localhost/cipher_day20_test \
DAY20_TEST_REDIS_URL=redis://127.0.0.1:6379/15 \
DAY20_EVIDENCE_PATH="$PWD/perf/jobs-day20-acceptance.json" \
  pnpm exec vitest run --project api day20.integration --no-file-parallelism
pnpm exec vitest run --project apps/web use-chat-socket.test
```

The acceptance fixture runs a real API OS process, actual Socket.IO clients,
PostgreSQL, and BullMQ/Redis. It uses IPC-only fault controls (no HTTP debug
routes), actually sends **SIGKILL** in both crash windows, restarts the API, drops
Redis connections, and deletes only its own queue to prove SQL reconciliation.
The rendering regression uses the production React/history hooks in jsdom.

[Sanitized acceptance evidence](../perf/jobs-day20-acceptance.json) records child
PIDs and checks: rollback, durable paused-worker acceptance, one replayed intent,
backoff, both crash windows, exhausted failure/re-drive, Redis outage and queue
loss, batches of 25, four actual concurrent claims, and fresh receive authority.
Duplicate notifications also have a regression asserting one rendered bubble.
CI's PostgreSQL job runs both Day 19 and Day 20 acceptance opt-ins; browser E2E
now has Redis because live message notification is asynchronous.

## Validation record

Local PostgreSQL 16.15 / Redis 6.2.20, Node 24 / pnpm 12.6:

- **204 Vitest tests passed, 36 files**, including both Day 19 and Day 20 real-service
  suites and the one-rendered-bubble regression.
- **13 Chromium browser E2E tests passed**, with the production web build, local
  API and real Redis consumer (system Chromium, not the pinned hosted browser image).
- Workspace type checks, production build, Biome formatting: passed.
- **14 CI-helper tests passed**; native lint: zero warnings/errors, with original
  severity/options/overrides preserved. The unchanged full plugin-enabled Oxlint
  command still hits the known sandbox allocator panic. Hosted full CI remains a
  merge gate; no lint policy was weakened.
- Production audit remains **5 low, 4 moderate, 1 high, 0 critical**, with no added
  advisory IDs versus the pre-existing baseline. BullMQ introduces no new finding.
  This is not a clean audit: the existing Zod constrained-collection memory
  advisory (GHSA-mrhx-c7xc-m3w5, patched in 4.6.6+) still needs separate remediation.

Small disposable fixtures establish correctness/recovery, not production capacity,
Redis HA/Cluster support, a security audit, or exactly-once peer delivery.
