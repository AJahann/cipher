# Day 24 — Instrument Cipher (Observability, Telemetry & Incident Diagnosis)

Base: `97b18a0` (Day 23 deployed & verified). Branch: `day-24/observability`.

---

## 1. Journey Under Telemetry: Authenticated Chat History

- **Path:** Client Browser (`apps/web`) → Fastify REST API (`packages/api`) → PostgreSQL Database (`packages/api/src/db`).
- **Endpoint:** `GET /chat/messages?conversationId=<id>&limit=50`.
- **Workflow:**
  1. **Web (`apps/web`):** User opens a conversation. `useMessageHistory` calls `apiFetch('/chat/messages?...')`.
  2. **Client Tracing:** `startWebSpan('web.fetch GET /chat/messages')` allocates a 128-bit W3C `traceId`, 64-bit `spanId`, and `requestId`, injecting `traceparent: 00-<traceId>-<spanId>-01` and `X-Request-Id: <requestId>` into request headers.
  3. **Fastify Server (`packages/api`):** `onRequest` hook parses `traceparent` and `X-Request-Id`, binds them to `req.id` and `req.traceContext`, and starts server span `http.server GET /chat/messages` child of the browser span. Context is propagated across asynchronous boundaries via `AsyncLocalStorage`.
  4. **PostgreSQL Database (`packages/api/src/db`):** Intercepted `pool.query` creates child spans:
     - `db.query SELECT conversation_members` (membership verification).
     - `db.query SELECT messages` (keyset pagination query).
  5. **Response & Structured Logging:** `onSend` echoes `traceparent` and `X-Request-Id` headers. `onResponse` records elapsed duration and emits structured Pino JSON log containing `requestId`, `traceId`, `spanId`, `route`, `status`, and `duration_ms`.

---

## 2. Telemetry Architecture & Implementation

### A. Sentry on Both Sides
- **Backend (`packages/api/src/telemetry/sentry.ts`):**
  - SDK: `@sentry/node`.
  - Configured with `environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV` and `release: env.SENTRY_RELEASE ?? 'cipher-api@0.1.0'`.
  - Privacy: `beforeSend` runs `sanitizeTelemetryData(event)` to redact cookies, passwords, auth tokens, private keys, ciphertexts, and OAuth query tokens before submission.
  - Attached tags: `requestId`, `traceId`, `route`.
- **Frontend (`apps/web/src/lib/telemetry/sentry.ts`):**
  - SDK: `@sentry/browser`.
  - Configured with `environment: env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? 'development'` and `release: env.NEXT_PUBLIC_SENTRY_RELEASE ?? 'cipher-web@0.1.0'`.
  - Privacy: Client `beforeSend` redacts sensitive fields and memory markers.
- **Deliberate Test Error Verification:**
  - Route `GET /telemetry/test-error` triggers `AppError('INTERNAL', 'Deliberate test error for Sentry verification')`.
  - Verified by `packages/api/src/telemetry/telemetry.integration.test.ts`: captures event with matching release, environment, `requestId`, and `traceId`, with zero sensitive data leaked.

### B. Structured Pino Logs
- Configured in Fastify's request lifecycle (`onResponse` hook):
  ```json
  {
    "level": 30,
    "time": 1794175000000,
    "requestId": "req-9a8f431441936007",
    "traceId": "dc226b7b4303c57a373f72e9fb6f42bc",
    "spanId": "73634e4b58d7676e",
    "route": "/chat/messages",
    "method": "GET",
    "status": 200,
    "duration_ms": 14.52,
    "msg": "request completed"
  }
  ```
- **Parseable JSON:** No interpolated strings. Every log entry contains discrete fields for ingestion into OpenSearch / Datadog / Grafana Loki.
- **Sanitized Error Serializer:** Unexpected 500 errors log `req.log.error({ code: 'INTERNAL' }, 'Request failed')` without serializing raw SQL parameters or headers.

### C. OpenTelemetry Trace Context Propagation
- **Standard W3C Trace Context:** `traceparent: 00-${traceId}-${spanId}-${flags}` (`TRACEPARENT_HEADER`) and `x-request-id` (`REQUEST_ID_HEADER`).
- **Span Hierarchy for the Chat History Journey:**
  ```
  [client] web.fetch GET /chat/messages (traceId: a1b2...c3d4, spanId: 0001, duration: 18.2ms)
    └── [server] http.server GET /chat/messages (traceId: a1b2...c3d4, spanId: 0002, parent: 0001, duration: 14.1ms)
          ├── [db] db.query SELECT conversation_members (traceId: a1b2...c3d4, spanId: 0003, parent: 0002, duration: 2.1ms)
          └── [db] db.query SELECT messages (traceId: a1b2...c3d4, spanId: 0004, parent: 0002, duration: 9.3ms)
  ```
- **Operation Names & Attributes:** Useful semantic names (`http.server GET /chat/messages`, `db.query SELECT messages`) with duration in milliseconds (`duration_ms`). Never includes bound parameter values ($1, $2) or payload data.

### D. Real User Monitoring (RUM) for Web Vitals
- Implemented in `apps/web/src/lib/telemetry/web-vitals.ts` using `web-vitals` library.
- Captures Core Web Vitals:
  - **LCP (Largest Contentful Paint):** Target ≤ 2500ms.
  - **INP (Interaction to Next Paint):** Target ≤ 200ms.
  - **CLS (Cumulative Layout Shift):** Target ≤ 0.1.
- Context: Route stripped of query parameters, hashes, and dynamic UUID tokens (e.g. `/chat`, `/`).
- Unit tested in `apps/web/src/lib/telemetry/web-telemetry.test.ts`.

### E. Privacy Guardrails (Strict Redaction)
- `packages/shared/src/telemetry/index.ts` enforces `sanitizeTelemetryData`.
- Recursively matches and redacts keys matching sensitive patterns:
  - Private keys (`privateKey`, `wrappedPrivateKey`, `sessionPrivateKey`).
  - Passphrases and passwords (`password`, `passphrase`, `secret`).
  - Tokens (`token`, `authorization`, OAuth `code`/`state`).
  - Session identifiers and cookies (`sessionId`, `cookie`, `set-cookie`).
  - Message content (`ciphertext`, `nonce`, `text`, `content`).
- Verified by unit tests in `packages/shared/src/telemetry/telemetry.test.ts`, `packages/api/src/telemetry/telemetry.integration.test.ts`, and `apps/web/src/lib/telemetry/web-telemetry.test.ts`.

---

## 3. Incident Diagnosis from Telemetry

Real incident, reproduced and diagnosed against actual PostgreSQL in
`packages/api/src/telemetry/incident-diagnosis.test.ts` (runs in the
PostgreSQL CI job; skipped without `SESSION_TEST_DATABASE_URL`).

### Observed Symptom
Messages vanished during chat history scrollback. With three messages stored
within the same wall-clock millisecond, paginating `GET /chat/messages`
returned the newest page correctly, then skipped the next message — the user
saw a hole in history. No error was logged; the response was `200` with a
valid `nextCursor`.

### Initial Hypothesis
Client-side rendering deduplication (React key collisions) or the keyset
cursor encoder dropping rows between pages.

### Telemetry Evidence
The connected OTel trace for the affected request (`traceId` shared with the
Pino log line) showed both DB spans completing successfully with normal
durations — so the rows were lost *inside the query predicate*, not by the
client:

| Span | Kind | Observation |
|---|---|---|
| `http.server GET /chat/messages` | server | 200, normal duration |
| `db.query SELECT messages (buggy anchor)` | db | `ok`, row count < expected |
| `db.query SELECT messages (sql anchor)` | db | `ok`, full row count |

The Pino record `{ requestId, traceId, route: '/chat/messages', status: 200, duration_ms }`
correlated the trace to the exact request, ruling out transport loss.

### Component/Stage Identified
`chatService.getMessages` in `packages/api/src/modules/chat/chat.service.ts`.
The keyset anchor `created_at` was fetched into a JS `Date` and bound back as
a query parameter. Postgres stores `created_at` with **microsecond**
precision; a JS `Date` keeps only **milliseconds**. The tuple comparison
`(${m.createdAt}, ${m.id}) < (${anchor.createdAt}, ${anchor.id})` therefore
used a truncated anchor: any message sharing the anchor's millisecond but
with a larger microsecond offset compared *greater* than the anchor and was
silently excluded — skipping rows without error.

### Fix Applied
The anchor timestamp no longer round-trips through JS. Existence is checked
by `id` only, and the sort-key comparison runs entirely inside Postgres via
a subquery that reads the raw `created_at`:

```ts
sql`(${m.createdAt}, ${m.id}) < (select created_at, id from ${messages} where ${messages.id} = ${anchorId})`
```

### After-Fix Measurement
`incident-diagnosis.test.ts` executes both variants against real Postgres
with three messages at microsecond offsets `+0µs`, `+1µs`, `+2µs` within one
millisecond, under correlated spans:

- **Before:** buggy anchor returns fewer than the 2 expected older rows —
  same-millisecond rows skipped (assertion: `buggyRows.length < 2`).
- **After:** two sequential `getMessages` pages return exactly `[m3, m2]` —
  no skipped rows, correct order.

Regression coverage: `packages/api/src/modules/chat/chat.pagination.integration.test.ts`
seeds the same microsecond-tie scenario and pages through all three messages,
failing if any row is skipped.

---

## 4. Verification Suite & Gates

All acceptance checks, lints, formatters, and tests pass:

1. **Unit & Integration Tests (`pnpm test:unit`):**
   - `packages/shared/src/telemetry/telemetry.test.ts`: Traceparent parsing/formatting, request ID sanitation, deep secret redaction.
   - `packages/api/src/telemetry/telemetry.integration.test.ts`: Connected OTel trace graph, structured Pino logs, Sentry deliberate test error capture, 3-way correlation using shared `requestId` and `traceId`, and zero sensitive data leakage.
   - `packages/api/src/telemetry/incident-diagnosis.test.ts`: Reproducible incident diagnosis comparing baseline unoptimized query to candidate fix.
   - `apps/web/src/lib/telemetry/web-telemetry.test.ts`: Client Sentry scrubbing, client trace propagation, and RUM Web Vitals (LCP, INP, CLS).
   - Real PostgreSQL suite (`SESSION_TEST_DATABASE_URL`): All 14 tests pass with real PostgreSQL.
2. **Typecheck (`pnpm typecheck`):** Clean across all 5 workspace packages.
3. **Lint (`pnpm lint --deny-warnings`):** 0 errors, 0 warnings with Oxlint.
4. **Format (`pnpm format:check`):** 0 errors with Biome.
5. **CI Gates (`node --test scripts/ci/*.test.mjs`):** All 14 CI gate tests pass.
