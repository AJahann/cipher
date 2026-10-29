# Day 19 — Redis: a copy cache and leased presence

Base: `c32caa1` (Day 18 merged). No message-delivery adapter, durable outbox,
background-job system, or cryptographic change. This is a coherence/lifecycle
exercise, **not a claim that Redis beats Day 18's fast PostgreSQL reads**.

## Directory: `GET /users`

The HTTP session is loaded from PostgreSQL and `requireAuth` runs before the
cache. Limit validation and cursor-kind/UUID decoding also run before lookup.
Limits are normalized numbers; cursor identity is its lower-case decoded UUID,
not its base64 spelling. HTTP responses use `private, no-store`; shared Redis
copies do not turn into a browser/proxy authentication bypass.

Implemented in `src/redis/directory-cache.ts` and `user.controller.ts`:

```text
{<namespace>:directory:v1}:generation = random epoch UUID
{<namespace>:directory:v1}:<epoch>:sha256(JSON([callerId,limit,cursorId|null]))
<page-key>:lock = random owner UUID, SET NX PX 2000
```

`v1` versions the format; **caller, limit, and cursor all shape the response**.
The page is the existing service's `{items,nextCursor}` JSON, with no SQL/query
rewrite. Cached data is schema-checked and checked for self-exclusion, ascending
IDs, and continuation-cursor consistency. `X-Directory-Cache` exposes
`hit`, `miss` (a database load, not a promise that population succeeded), or
`fallback` for acceptance/reproduction.

### Coherence and its limits

- Page TTL is **at most 10 seconds from lock acquisition, before the database read**, not from
  a delayed cache write. The Redis clock fixes the deadline and computes the remaining TTL in fill Lua, so delayed transport cannot extend it. No sliding expiration or stale-while-revalidate.
- Registration calls epoch invalidation **after its SQL transaction commits**,
  before responding. There are currently no username-edit/delete endpoints.
  Future directory-changing writers must call the same post-commit invalidation;
  out-of-band SQL changes have only the TTL bound.
- Invalidation sets a fresh random epoch. Restart/eviction cannot recreate an old
  counter value. Old pages expire naturally; no production `KEYS` scan.
- Fill Lua atomically requires both the captured epoch and the unexpired lock's
  owner token. A successful invalidation fences old fills; an old owner cannot
  fill after losing its lock. Unlock Lua compares the token before deletion.
- **Not linearizable/read-your-writes.** Already-started or coalesced requests can
  return an earlier PG snapshot. If invalidation fails or the process dies after
  commit but before invalidating, existing copies may remain until their original
  ten-second deadline. TTL bounds stored copies, not the duration/freshness of
  an in-flight PG transaction. SQL and Redis are not an atomic commit.

Identical overlapping requests share one promise per process. An expiring
distributed fill lock usually makes this one PG read across processes. Other
processes poll three times at 40 ms, then use bounded PG fallback rather than
waiting indefinitely. Each process admits **8 active directory PG reads** and
**256 distinct in-flight keys**, rejecting excess work with the existing `429`
envelope; there is no unbounded queue. With a slow fill/outage this is not a
global exactly-once/QPS guarantee: bounds are per process.

Redis uses a **150 ms command timeout**, 500 ms connect timeout, no offline
command queue, and no request-command retry. Infrastructure reconnection retries
in the background every second. Redis errors fall back to PG; they never skip
authentication. Multi-command paths can consume more than one command budget;
PostgreSQL execution retains its existing database timeout policy.

## Presence: a lease, never message/session authority

`online = at least one unexpired authenticated connection lease in Redis`.
Each Socket.IO connection has a separate random token, including two tabs of
the same account on different processes. Default lease **15 s**, authenticated
refresh/current-state reconciliation **every 5 s**. `PRESENCE_LEASE_MS` may be
3000–60000; tests use 3000 (refresh 1000). Time comes from Redis `TIME`, not the
API hosts' wall clocks.

```text
{<namespace>:presence:v1}:user:<userId> = ZSET(token -> expiresAt)
{<namespace>:presence:v1}:due = ZSET(userId -> earliest lease expiration)
<namespace>:presence:v1:transitions = Pub/Sub transition-hint channel
```

Atomic Lua prunes expired tokens, renews/removes only the connection's token,
updates the due index, and publishes first-online/last-offline transition hints.
Lease sets also have a physical expiry backstop. Every live API sweeps up to
100 due users per second; current-state reads prune their target immediately.
No keyspace-notification setting or single designated leader is required.
After a crash, logical online contribution expires at its last accepted lease
deadline; cleanup notification follows the surviving sweeper (large backlogs
can delay notifications). No running API means no observer; startup/snapshot
reads still prune expired state.

Subscribers re-read current state instead of trusting an old Pub/Sub boolean.
Per-connection work is coalesced/serialized. A fresh SQL membership join determines
the authorized peers; PostgreSQL session authority is checked before work and
again before emitting. Redis updates do not grant room membership, authentication,
or permission to receive messages.

Events:

- `presence:update`: `{userId,status:'online'|'offline'|'unknown',online:boolean|null}`.
- `presence:snapshot`: `{states,availability:'available'|'unknown'}`. Only peers
  with a shared conversation appear; the public directory is not a subscription.
- Client `presence:sync` requests fresh reconciliation under the event limiter.
  Connection, successful resubscription, and periodic refresh supply snapshots
  automatically. Duplicates are allowed; this is current state, not an ordered
  or durable presence history. Existing UI has no peer-presence badge.

Redis/subscription uncertainty means **unknown/null, not offline/false**.
A subscriber-only failure still refreshes authenticated local leases if commands
work. Recovery renews live leases and snapshots peers, repairing missed messages.
Session destruction remains PG-authoritative: local session-room disconnect is
immediate, remote sockets retain the existing at-most-five-second idle authority
check; sensitive events recheck before use. Presence emission checks PG directly.

**Deployment boundary:** only directory caching/presence are cross-instance.
Message/typing rooms, local abuse limits, and immediate revocation broadcasts
are not made distributed. Keep the supported messenger deployment single-API
until those separate requirements are implemented. These clients target a
standalone Redis service; hash tags keep Lua keys colocated, but Redis Cluster
deployment/support is not claimed. Use private/ACL-protected Redis and TLS as
appropriate; a namespace is collision isolation, not a security boundary.

## Reproduction and acceptance

Set optional API settings in `.env`: `REDIS_URL`, `REDIS_NAMESPACE` (default
`cipher`), `PRESENCE_LEASE_MS` (default 15000). Without Redis, directory requests
use bounded PG fallback and presence is unknown; password-only startup still works.

Install/start PostgreSQL 16 and Redis 6.2+ locally. Use a **disposable** PG database
and loopback Redis database **15**; the fixture uses a unique namespace and cleans
only its users/conversations/keys, not a production `FLUSHDB`. From repository root:

```bash
pnpm install --frozen-lockfile
SESSION_TEST_DATABASE_URL=postgresql://localhost/cipher_day19_test \
DAY19_TEST_REDIS_URL=redis://127.0.0.1:6379/15 \
DAY19_EVIDENCE_PATH="$PWD/perf/redis-day19-acceptance.json" \
  pnpm exec vitest run --project api day19.integration \
    directory-cache.test presence.test --no-file-parallelism
```

The test forks **two separate API OS processes**, checks their returned PIDs
against the spawned processes, and shares PG/Redis. An IPC-only test worker (not
an HTTP debug route) pauses fills/subscriptions. A transparent TCP proxy drops or
blackholes Redis traffic; it does not shut down someone else's Redis server.
One API is actually killed with `SIGKILL`, without disconnect cleanup.

Committed [sanitized acceptance evidence](../perf/redis-day19-acceptance.json)
records the actual worker PIDs (including the replacement process) and checks:

| Area | Acceptance evidence |
| --- | --- |
| Directory | miss → populate → hit through another API; caller/limit isolation; auth/invalid cursor rejected before cache; ordered page/reference equality |
| Coherence | registration epoch change; paused old fill fenced; failed invalidation explicitly demonstrates stale copy expiring at original TTL |
| Miss control | 40 concurrent requests across both APIs use at most 2 PG reads; owner-only expiring unlock; unit test caps active PG fallback at 8 |
| Shared presence | A/B clients receive peer updates; unrelated authenticated user never receives peer metadata |
| Lifecycle | cross-instance two tabs; one close stays online; last close offline; real process kill/lease expiry; missed-event subscriber recovery |
| Failure/security | bounded blackhole timeout; Redis-down PG fallback/auth enforcement; unknown → available recovery; logout on A revokes B's send/cache access |

CI's PostgreSQL job adds a disposable Redis service and runs these tests serially.
No Redis-vs-PG latency, production throughput, Redis HA/Cluster, or large-peer-set
load claim is made.
## Validation record

Local disposable PostgreSQL 16.15 / Redis 6.2.20, Node 24 / pnpm 12.6:

- Complete Vitest suite with both integration opt-ins: **193 passed, 35 files**.
- Workspace type checks and production build: passed.
- CI-routing helper tests: **14 passed**; Biome format check: passed.
- Native lint, preserving configured severity/options and overrides:
  **zero warnings/errors**. Full JavaScript-plugin lint still hits the previously
  documented sandbox Oxlint allocator panic, even with one worker; checked-in
  lint policy is unchanged. Full plugin-enabled hosted CI remains the merge gate.
- Production dependency audit: **5 low, 4 moderate, 1 high, 0 critical**.
  An isolated audit of unchanged base `c32caa1` has the same advisory IDs/counts;
  ioredis adds none. This is **not a clean audit**. In particular Zod's
  [oversized constrained-collection memory advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
  needs a separate dependency remediation (patched in 4.6.6+). No unrelated
  dependency upgrades are bundled into this exercise.

Tests are correctness/failure-injection evidence on small fixtures, not production
capacity or security-audit evidence. Browser E2E and hosted CI were not run as
part of this local record.
