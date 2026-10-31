# Day 21 — Security boundaries and abuse controls

## Inspection inventory (before implementation)

Reviewed on `09caa1e` before security code changes. A control below is only credited
where the named implementation was inspected; this is not a security audit.

| Surface / source | Identity and authorization | Schema / size | Work triggered | Existing abuse budget and failure / gap |
| --- | --- | --- | --- | --- |
| Password register/login — `modules/auth/auth.controller.ts`, `modules/user/user.service.ts`, `modules/auth/password.ts` | Anonymous credentials; signed PG session rotated on success; username uniqueness; registration keys + account transaction | Shared username 32, password 128 characters, wrapped bundle bounded | Lookup, Argon2id (19 MiB/two passes), legacy bcrypt/rehash, SQL writes, session save, cache invalidate | Shared IP 30/min in handler, hash concurrency four; IP rejection occurs after parsing/session load; auth Origin check only when present |
| Optional GitHub — `modules/auth/github.controller.ts`, `github.service.ts` | Opt-in; session-bound one-use state, PKCE, explicit authenticated linking, no implicit provisioning/transfer | State 43 chars, code <=1024; provider identity schema, ten-minute flow | Session/flow writes, expiry cleanup, two external fetches (10s timeout each), identity link | IP 60/min onRequest; link strictly trusted Origin; no account budget; callback SQL consumes flow before code validation |
| Directory / public key — `modules/user/user.controller.ts`, `user.service.ts`, `redis/directory-cache.ts` | Auth required before cache; directory excludes self; public keys intentionally directory-visible to any authenticated user | UUID, limit 1–100, cursor <=512 with list-kind semantics | Redis read/fill and bounded PG miss, key lookup | Cache <=256 in-flight keys / eight active PG loads, ten-second TTL; no HTTP account budget; cached user strings/raw bytes not deliberately bounded |
| Conversation create/list — `modules/chat/chat.controller.ts`, `chat.service.ts` | Session identity; create with existing non-self member; unique DM pair; listing filtered by membership | Member UUID; list has no pagination | Member lookup, transactional insert/membership writes or nested list read | No IP/account HTTP budget or common mutation Origin rejection; list cost/output grows with total memberships (open) |
| Message history — same controller/service, `http/cursor.ts` | Fresh membership check and cursor anchor belongs to conversation | UUID, limit 1–100, cursor <=512 | Membership/anchor lookup + keyset read | No HTTP account budget; generic parser limit only |
| Socket handshake — `app.ts`, `modules/chat/chat.socket.ts` | Exact configured Origin required; signed cookie, PG session; session rooms; periodic revocation checks | Cookie parsing; default Engine.IO payload ceiling | Engine connection, session lookup, profile/membership bootstrap, timers/leases | IP 60/min at namespace auth (after Engine allocation); no account connect/live-tab cap |
| Send/read/join/typing/leave — `chat.socket.ts`, `chat.service.ts` | Send/read/join recheck session; SQL membership/read target; typing uses authorized room; leave only removes room | Shared UUIDs, ciphertext <=65536 chars, nonce <=256, algorithm <=64 | Session lookup, message+outbox transaction, read write, room work/emits | Shared account 120/10s survives reconnect; leave unmetered; idempotency and conflict checks durable; receive authority separate from presence |
| Presence sync — `chat.socket.ts`, `redis/presence.ts` | Reconciliation rechecks session before/after Redis and loads fresh peers | No client arguments required; infrastructure transition JSON inspected but not bounded | PG authority/peer reads, lease renewals, per-peer Redis reads, peer snapshots | Shared socket-event budget, coalesced per-connection reconciliation, leases; tabs/reconnects multiply recurring cost; peer fanout grows with degree (open) |
| Notification jobs — `jobs/notification-jobs.ts`, `notify-message.ts` | SQL outbox intent authoritative; fresh membership + session before per-socket emit | Event UUID/generation checked after direct destructure; malformed null payload can bypass intended validation branch | Bounded SQL claim, notification, retries | Batch25/concurrency4/three durable attempts, retained failures; improve strict infrastructure shape validation; no claim of delivered/read |
| Operator inspect/re-drive — `jobs/cli.ts`, `operations.ts` | Trusted shell + DB credentials only, no HTTP route; failed-only generation bump | CLI UUID; inspect LIMIT100 | SQL read or conditional update | No internet-facing account budget; library helper itself lacks UUID validation; DB role is powerful (deployment trust) |

Implementation and acceptance results are recorded below after verification.

## Enforced policy

`src/security/policy.ts` is the policy source of truth. Keys below are separate
maps owned by one `buildApp()`/API runtime, **not Redis/global counters**. Account
keys use the authenticated PostgreSQL session's UUID, never a client-supplied
sender, tab, socket ID, cookie ID, username, or forwarded header.

| Budget / concrete key | Threshold / window | Coverage / rejection boundary |
| --- | --- | --- |
| `ip.http:<req.ip>` | 300 / 60s | All Fastify requests including health/not-found; root onRequest before body parsing and session store reads |
| `ip.password:<req.ip>` | 30 / 60s | Shared registration/login budget before parsing, hashing, account creation or session rotation |
| `ip.github:<req.ip>` | 60 / 60s | OAuth start/status/link/callback, including disabled routes; before flow cleanup/writes or provider fetch |
| `ip.handshake:<remoteAddress>` | 60 / 60s | Initial Engine.IO handshake, before namespace cookie parsing/PG lookup; failed Origin/auth attempts consume it too |
| `account.read:<userId>` | 180 / 60s | All authenticated GET/HEAD: directory/cache hits, public keys, conversations, message history, self/key bundle, OAuth status/start |
| `account.conversation:<userId>` | 20 / 60s | POST conversation get-or-create before member lookup/transaction, including existing-pair requests |
| `account.mutation:<userId>` | 30 / 60s | Other authenticated HTTP mutations, including link/logout/password routes when already authenticated |
| `account.connect:<userId>` | 30 / 60s | Namespace authentication after session lookup, before profile/membership bootstrap; reconnect does not reset it |
| `account.event:<userId>` | 120 / 10s | Shared send/read/typing start+stop/join/leave/presence sync, before session lookup or mutation; reconnect/extra tabs do not reset it |
| `account.presence:<userId>` | 10 / 10s | Additional aggregate presence-sync limit before reconciliation; automatic lease refresh remains available |

HTTP account checks necessarily follow the session-store read that identifies the
account, but precede controller work. A budget denial drops only the request-local session reference
before the session plugin's response hook: it does not roll/save, destroy the
server session, revoke sockets, or clear the cookie. Recovery reuses the same
authority. Tests assert no rolling session write on account-limit rejection.
Anonymous protected reads still return 401
before cache/database business reads. Limits are admission counts, not success
counts: invalid/replayed/conflicting commands consume them. A rate-limited replay
may be retried later with the same permanent command ID; it never creates another
logical intent. Successful ack remains durable acceptance, not delivery/read.

Each of ten limiter maps holds at most 10,000 keys (100,000 total entries).
Expired keys are reclaimed on capacity pressure; live entries are never evicted
to admit a new identity. Saturation fails closed with RATE_LIMITED. Counters stop
incrementing at the threshold. Sweeps inspect at most 10,000 entries per map;
storage is bounded, but sustained saturation can consume scan CPU. No unbounded
waiter queue is introduced. Windows begin with the first admitted request. Up to
twice the threshold can occur across a window boundary; these are **not** smooth
rolling-window or per-second guarantees. Restarts reset budgets, NAT users share
IP budgets, and account creation/multiple source IPs remain abuse avenues.

Live socket work is additionally capped at **eight connections/account and 256
per API**; disconnect releases a slot exactly once. This bounds recurring
session timers and connection leases, not only arrivals. It does not bound the
number of peers/conversations per account. Existing four-way password hashing,
eight active directory PG misses, 256 cache in-flight keys, job batch25,
concurrency4, finite durable attempts/backoff and SQL authorization remain.

### Size and infrastructure boundaries

- Fastify request bodies: **16 KiB** bytes (registration fits well below this).
- Engine.IO payload: **96 KiB** bytes, for polling and WebSocket; WebSocket
  per-message compression stays disabled. A frame over the transport ceiling is
  disconnected, not promised an application ack. The existing maximum base64
  ciphertext (65,536 characters) fits; multibyte/extra fields still count toward
  the byte ceiling. Socket fields retain UUID, nonce256 and algorithm64 limits.
- Shared HTTP contracts retain username32, password128 characters, bounded key
  bundle, page limit1–100 and cursor512. HTTP URL/header limits remain Fastify/
  Node defaults; deployment must also enforce request/header/connection/time
  ceilings. This work does not impose a total per-account conversation cap.
- Cached directory JSON is refused before parsing above **32 KiB**. Accepted
  copies must pass the page schema, username<=32, canonical lowercase UUIDs,
  caller exclusion, strict UUID ordering, requested page size and continuation
  semantics. Bad copies are misses/fallback, never an authentication bypass.
  Redis transport still buffers the response before this application byte check;
  an infrastructure administrator can exhaust memory by compromising Redis.
- Jobs use a strict `{eventId: UUID, generation: int32 >= 0}` schema before
  destructuring/SQL; arrays/null/extra fields/invalid integers are rejected.
  Outbox identity, status, generation, attempts and leases remain authoritative.
  Redis is trusted to operate the scheduler, **not** to authorize recipients.
  Malformed jobs fail through BullMQ's finite retry/retention policy; trusted DB
  reconciliation can reconstruct legitimate pending work. This does not bound
  malicious Redis writes or Redis's JSON deserialization costs.
- Operator `redrive()` now validates UUID at its library boundary too. Inspection
  stays LIMIT100; re-drive stays failed-only with a fresh generation and retained
  failure history. Trusted shell/DB credentials authorize it; no HTTP re-drive
  route or pretend browser/account limiter exists. Restrict shell, network and
  database-role access. Queue-loss/outage rules from Day20 are unchanged.

### Browser, proxy, and log trust

For **every non-GET/HEAD/OPTIONS HTTP request**, a present Origin must equal
CLIENT_ORIGIN exactly. Foreign, malformed, empty and literal `null` origins get
400 BAD_REQUEST before session-store work/controller effects. CORS alone is not
the enforcement. Trusted Origin is accepted subject to authentication/validation.
Absent Origin remains accepted for non-browser clients using an explicit cookie;
GitHub linking retains its stricter requirement for a present trusted Origin.
Modern browser cookie controls (`HttpOnly`, `SameSite=Lax`, production Secure)
remain; an Origin header is not authentication, and a non-browser attacker can
set it but still needs valid credentials/session authority. Absent-Origin policy
is not a universal CSRF defense for legacy/nonconforming browsers; if these are
supported, add reviewed token-based CSRF instead of claiming full protection.
OAuth GET callback uses one-use session state/PKCE rather than a browser Origin
requirement; start may write a short-lived flow and is budgeted accordingly.

WebSocket initial handshakes continue to require a present exact Origin. Explicit
`trustProxy: false` means Fastify uses the socket peer IP; Engine.IO likewise uses
`remoteAddress`, never X-Forwarded-For/Forwarded. **No forwarded-IP infrastructure
is trusted by this change.** Behind TLS termination, budgets will intentionally
aggregate on the proxy's address. A future proxy configuration must name the
specific trusted proxy CIDRs/hops and consistently sanitize headers for both HTTP
and Engine.IO; never enable blanket `trustProxy: true`. Keep one messenger API,
TLS at the reviewed edge, header/connection/request timeouts and edge DDoS/polling
controls. Initial-handshake limits do not meter every existing Engine.IO polling
request; account event controls meter business work, not all transport CPU.

Access logs allowlist method, path without query, hostname and socket peer IP.
Request headers/body are never serialized. Unexpected HTTP and socket errors log
fixed categories rather than raw exceptions/SQL parameters/provider bodies.
Framework error serialization is sanitized; startup failures use a fixed string.
OAuth query values are not included in not-found responses. Tests use explicitly
synthetic credentials only. Logging metadata (user IDs/IPs) still needs retention
and access controls. Sanitization sacrifices detailed stack diagnostics; add a
reviewed secret-safe observability channel, not raw exception logging.

## Code-linked threat checklist

Uses the explicitly versioned [OWASP Top 10:2021](https://owasp.org/Top10/2021/)
as a checklist, not a certification or an assertion that uninspected paths are
safe. Source paths below are relative to `packages/api/src` except web/shared.

| Threat / affected code | Impact | Status / control | Residual risk |
| --- | --- | --- | --- |
| A01 object access — `chat.service.ts` send/history/read; `chat.socket.ts` join/typing; `notify-message.ts` | Read another conversation, forge receipts, receive private hints | **Mitigated for inspected paths:** SQL membership and target-conversation checks; session recheck before emit; typing requires both room and fresh SQL membership; real nonmember/stale-room tests | Revocation cannot cancel already-authorized in-flight work; idle authority window <=5s; no broader audit claimed |
| A07 credential stuffing/hash exhaustion — `auth.controller.ts`, `password.ts`, `security/http.ts` | CPU/RAM exhaustion, account compromise | **Partially mitigated:** early shared password IP budget, Argon2id cost/concurrency4, bounded credentials, generic invalid-credential response | Distributed IP attacks, NAT contention, no MFA/recovery or claimed global/account-credential lockout; API receives wrapping password |
| A04 resource amplification — `security/policy.ts`, `chat.socket.ts`, controllers | Writes/jobs/DB reads/lease work amplified across tabs | **Partially mitigated:** account budgets shared across sessions/sockets/reconnects, live socket cap, early byte ceilings, bounded counters, no-side-effect rejection tests | Restart resets, burst at window boundary, many accounts/IPs, per-account conversation list/peer fanout and transport CPU not fully bounded |
| A01/A05 cookie-authenticated cross-origin mutation — `security/http.ts`, `app.ts`, `github.controller.ts` | Session riding, unsolicited conversations/account links | **Partially mitigated:** actual present-Origin rejection for all mutations; strict WS Origin; GitHub link requires trusted Origin; SameSite/HttpOnly/Secure | Absent-Origin HTTP compatibility deliberately retained; no token CSRF for legacy browsers; Origin is not identity |
| A05 forwarded-IP spoofing — `app.ts` allowRequest/trustProxy | Evade budgets by supplying fake X-Forwarded-For | **Mitigated in supported direct-peer configuration:** neither HTTP nor Engine.IO trusts forwarded client IP; spoof/recovery tests | Reverse proxy aggregates clients; future proxy policy or multiple APIs requires separate reviewed coordinated controls |
| A08 poisoned Redis copies/jobs — `redis/directory-cache.ts`, `redis/presence.ts`, `jobs/notification-jobs.ts` | Bad directory data, notification amplification, unsafe recipient selection | **Partially mitigated:** byte/shape/order/caller/cursor checks, strict event payload, fresh SQL authority, bounded attempts, authorized presence peers | Redis admin compromise can forge plausible public directory values, consume resources, lose schedules, or suppress notifications; cache is not cryptographically authenticated |
| A03 SQL injection — `chat.service.ts`, `user.service.ts`, `jobs/*` | SQL data disclosure/modification | **Mitigated for inspected queries:** Drizzle/bound parameters; cursor IDs validated; no client-built SQL identifiers; operator UUID validation | Trusted DB credentials still grant powerful access; no exhaustive automated injection audit |
| A07 session replay/resurrection — auth/session authority and `db/session.ts` | Continue sending/receiving after logout | **Mitigated within documented window:** session rotation, PG revocation tombstone/serialized saves, local disconnect, rechecks; existing transport tests retained | Stolen live cookie remains authority until expiry/revocation; no instantaneous distributed revoke; outstanding authorized work can complete |
| A09 sensitive logging / missing detection — `security/logging.ts`, `http/errors.ts`, `server.ts`, socket error paths | Leak cookies/passwords/keys/OAuth codes; undetected attacks | **Partially mitigated:** allowlisted access logs, fixed errors, captured real HTTP log regression | No alerting/SIEM/rate-limit dashboards or full external logging audit; metadata retention and privileged operator output need deployment controls |
| A02 malicious server / key substitution — `docs/SECURITY-ARCHITECTURE.md`, shared crypto and peer-key endpoint | Server captures wrapping password or substitutes a peer key | **Open:** preserved explicit limitations, not solved by rate limits or validation | No zero-knowledge auth, audited fingerprints/key transparency, ratchet/forward secrecy; do not use for high-risk communications |
| A03/A08 browser-origin compromise — `apps/web`, shared browser crypto | XSS/host compromise reads live plaintext and keys or replaces crypto | **Open:** this work does not audit all rendering, CSP or asset supply chain | HttpOnly protects cookie access, not authorized same-origin actions/plaintext; no claim that security tests solve browser compromise |
| A06 vulnerable components — lockfile, Zod shared/API dependency | Library-level denial of service or other advisories | **Open pending separate dependency remediation:** retain and report production audit rather than declaring a clean audit | Existing constrained-collection Zod memory advisory is not repaired merely by bounded application schemas |
| A10 arbitrary-target SSRF — `modules/auth/github.service.ts` | Fetch internal services with application credentials | **Not applicable to inspected OAuth fetch target selection:** fixed GitHub HTTPS endpoints, redirect:error and 10s timeouts; no request-selected fetch URL | Operator-supplied DB/Redis URLs and future fetch features are separate trusted deployment inputs; upstream response-body sizes rely on provider/runtime |

## Change summary

Retained PG session/revocation authority, SQL membership checks, payload conflict
semantics and permanent message command identity, atomic outbox, authorized job
fan-out, cache TTL/coherence, expiring presence and unknown-on-outage behavior.
Fixed the missing HTTP account budgets/common mutation Origin guard, moved auth
IP admission before parsing/session work, bounded Engine.IO payloads and live tabs,
metered leave/sync events, rechecked typing membership instead of trusting stale rooms, hardened infrastructure payloads, and stopped raw error
logging. No message schema/migration, encryption format, queue topology, global
limiter claim, peer-delivery claim, or supported deployment expansion is included.

## Reproduction and acceptance

Use disposable PostgreSQL and Redis only (the suites insert/delete synthetic
accounts and exercise queue loss/process kills). Apply the normal environment
configuration, then run:

```sh
SESSION_TEST_DATABASE_URL='<disposable-postgres-url>' \
DAY19_TEST_REDIS_URL='redis://127.0.0.1:6379/15' \
DAY20_TEST_REDIS_URL='redis://127.0.0.1:6379/15' \
pnpm test:unit --no-file-parallelism
pnpm typecheck
pnpm format:check
pnpm lint
pnpm build
```

`security/security.integration.test.ts` exercises real HTTP, signed PG sessions,
Socket.IO and SQL row counts. It injects a clock **only into limiter counters**
through a trusted builder test option; network IO, session expiry, authorization,
PostgreSQL transactions and Socket.IO remain real. Production uses Date.now;
clients cannot alter the clock, thresholds or controls. This avoids minute-long
sleeps while testing actual route/event rejection and window recovery.

Acceptance covers password/general HTTP/initial-handshake IP ceilings before
session business work; shared account reads across six routes/two sessions;
conversation admission before writes; socket tabs/reconnect/independent-account
behavior; presence-sync budget; expired-window recovery; real untrusted/missing WS
Origin rejection and all mutation Origin policies; oversized HTTP/socket input;
unauthorized send/read/join/typing/history and cross-conversation cursor; no
message/outbox/read/conversation side effect for rejected mutations; one row and
one intent for replay, conflict rejection; malformed cache/job inputs before use;
and actual sanitized HTTP error/access logging. Unit tests also exercise limiter
capacity and live socket slot release/process-wide limits. Full earlier Day19/20
suites remain the proof for lease/queue crash and outage behavior, not assumptions.


### Local verification record

- Complete Vitest suite: 239 tests across 39 files passed with PostgreSQL 16 and
  Redis 6.2, including real Day19 two-process and Day20 crash/queue-loss suites.
- Chromium end-to-end: 13 passed against a production web build, a dedicated
  disposable database, and the API/Redis job consumer (system Chromium locally,
  not the hosted pinned browser image).
- Workspace types and production build passed with explicit non-production env.
- Native lint passed with original rule options/overrides preserved. The unchanged
  full JS-plugin Oxlint command hits the previously observed sandbox allocator
  panic; hosted full lint must pass before merge. No lint rule is disabled by
  this change.
- Production audit: 5 low / 4 moderate / 1 high / 0 critical, unchanged from the
  Day20 baseline. The high is Zod GHSA-mrhx-c7xc-m3w5 (patched >=4.6.6). Dependency
  changes are deliberately separated from this admission/authority patch; this
  known issue remains open, not dismissed as unexploitable by today's bounds.
