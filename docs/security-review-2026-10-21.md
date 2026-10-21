# Cipher — codebase deep dive

Reviewed: 21 October 2026  
Repository: https://github.com/AJahann/cipher  
Pinned revision: `8d281a33cfac772317862cf60c2a210f5f7d216b`

## Executive assessment

Cipher is a well-structured educational encrypted messenger with useful separation between transport, application services, shared contracts, and reusable UI. Its PostgreSQL constraints, message idempotency, membership checks, keyset pagination, and explicit GitHub linking show thoughtful engineering.

It is not ready for sensitive production communication. The most important work is not a framework rewrite: it is session revocation across transports, safer account-password handling, conversation-scoped UI state, reliable reconnect/delivery recovery, and dependency updates. The README's independent-audit warning is appropriate.

This review inspected source, ran the existing automated checks locally, started an isolated PostgreSQL database, and added temporary regression probes. No remote files, commits, issues, or pull requests were changed. No production systems were tested. This is a code review and bounded local assessment, not a formal cryptographic audit, load test, or certification.

## Architecture and request flows

- `apps/web`: Next.js/React client. TanStack Query owns HTTP server state; module-level Socket.IO client supplies realtime events; `ChatPage` owns plaintext rendering and an in-memory outbox.
- `packages/api`: Fastify routes, PostgreSQL-backed sessions, Socket.IO handlers, Drizzle services/schema/migrations.
- `packages/shared`: Zod transport contracts, DTOs, libsodium public-key encryption, password-based private-key wrapping, and the in-memory unlocked key.
- `packages/ui-web` and `packages/ui-tokens`: reusable presentation and design tokens.

Registration generates an X25519 key pair in the browser, derives an Argon2id wrapping key from the account password, wraps the private key with secretbox, and posts the bundle and password to the API. The API stores a bcrypt password hash and the encrypted bundle. Login rotates the session and returns the bundle. The browser unwraps it locally. GitHub login instead authenticates a linked identity, after which `SessionGate` fetches the correct bundle and asks for the passphrase.

Sending encrypts plaintext with the peer's public key and the sender's private key. A stable client command UUID accompanies the ciphertext. The service checks membership and inserts idempotently. Socket handlers broadcast and acknowledge. History is read over HTTP and decrypted in the browser.

Sources: [README](https://github.com/AJahann/cipher/blob/8d281a33cfac772317862cf60c2a210f5f7d216b/README.md), [client auth](https://github.com/AJahann/cipher/blob/8d281a33cfac772317862cf60c2a210f5f7d216b/apps/web/src/components/auth-page.tsx), [message service](https://github.com/AJahann/cipher/blob/8d281a33cfac772317862cf60c2a210f5f7d216b/packages/api/src/modules/chat/chat.service.ts).

## Verification

- Frozen-lockfile installation: passed, pnpm 12.6.0 / Node 24.14.1.
- Existing Vitest suite with local configuration and PostgreSQL enabled: **122 tests passed in 22 files**, including the 23 database-gated tests that otherwise skip.
- Type-checking all workspaces: passed.
- Production build of all workspaces: passed, including Next.js prerendering.
- Biome formatting check: passed.
- Targeted conversation-switch probes: **2 passed**, meaning both asserted undesirable behaviors were reproduced. These are characterization tests, not tests proving the implementation is correct.
- Chromium E2E: **9 passed**, including the authentication setup, send/receive, contacts, unlock, and accessibility checks. A system Chromium override was used for this environment. Firefox and WebKit were not run.
- Lint: **unverified**. Oxlint panicked inside its Rust allocator both normally and with `--threads=1`; no conclusion about source lint cleanliness follows.
- Dependency audit: full graph reported **3 critical, 5 high, 11 moderate, 2 low** advisories. Production-only graph reported **3 critical, 3 high, 4 moderate, 1 low**. These are advisory findings, not counts of demonstrated exploitable paths.

The initial unit run lacked `NEXT_PUBLIC_API_URL`; that configuration issue was corrected before the successful run. Initial browser runs needed the correct system Chromium path and Playwright's FFmpeg helper. Neither setup failure is presented as an application bug.

## Prioritized findings

### 1. High — logout does not revoke existing sockets

**Reproduced.** `chat.socket.ts:64–96` authenticates once during connection and copies `userId` into socket data. Event handlers thereafter trust that identity. `auth.controller.ts:42–45` destroys the HTTP session but neither disconnects its sockets nor makes them revalidate authority.

Local sequence: register → connect socket → POST logout → GET `/auth/me` → send over the existing socket. Logout returned 200, HTTP returned 401, but the socket remained connected and the message was accepted.

Impact: a retained/stolen socket can continue acting after the user believes logout revoked access. The same design needs to account for expiration and session rotation, not just explicit logout. This does not by itself reveal plaintext to an attacker who lacks encryption keys.

Fix: retain a session identifier on socket data, join a session-scoped room, disconnect that session's sockets on revocation/rotation, and enforce expiration or bounded revalidation on sensitive events. Do not disconnect all of a user's devices unless that is the intended logout policy. Add live-socket logout, rotation, expiry, and revoked-session receive/send regression tests.

[Socket authentication and handlers](https://github.com/AJahann/cipher/blob/8d281a33cfac772317862cf60c2a210f5f7d216b/packages/api/src/modules/chat/chat.socket.ts#L64-L96) · [Logout](https://github.com/AJahann/cipher/blob/8d281a33cfac772317862cf60c2a210f5f7d216b/packages/api/src/modules/auth/auth.controller.ts#L42-L45)

### 2. High — bcrypt truncation disagrees with the permitted passphrase length

**Reproduced.** Registration permits 128 characters, while bcrypt only considers the first 72 bytes. A synthetic account registered with 72 `a` characters plus `original-suffix` accepted a login using the same prefix plus `different-suffix` and returned HTTP 200.

This grants an API session; it does **not** automatically unlock the private key, because Argon2id uses the full original passphrase. The mismatch therefore creates authentication equivalence and inconsistent recovery behavior. Multibyte passphrases reach the byte limit sooner than character-count validation suggests.

Prefer migrating account-password hashing to a suitable Argon2id implementation with a versioned hash and rehash-on-login plan. A smaller immediate mitigation is consistent UTF-8 byte-length validation on both registration and login, with explicit handling for existing over-limit accounts. Do not silently truncate or introduce an unreviewed prehash scheme. Update the UI and contracts together.

[Password contract](https://github.com/AJahann/cipher/blob/8d281a33cfac772317862cf60c2a210f5f7d216b/packages/shared/src/contracts/user.ts#L10-L25) · [bcrypt usage](https://github.com/AJahann/cipher/blob/8d281a33cfac772317862cf60c2a210f5f7d216b/packages/api/src/modules/user/user.service.ts#L18-L79)

### 3. High UX/privacy risk — conversation changes retain the previous conversation's state

**Reproduced in two component tests.** `ChatLayout` renders the same unkeyed `ChatPage` as conversation props change. `ChatPage`'s input, decrypted output, pending messages, and errors are local state. The outbox is not scoped or filtered by conversation.

- A draft written for Alice remains in the composer after switching to Bob. Sending now targets Bob.
- A failed message intended for Alice remains rendered under Bob's conversation header. Its retained retry payload still targets Alice; the display is wrong even though that retry is not silently retargeted.

A minimal isolation fix is keying `ChatPage` by conversation ID. However, that discards the in-memory outbox on navigation. A better durable design stores outboxes by `(accountId, conversationId)`, retains retries deliberately, and scopes drafts/decrypted state to the same identity. Reset or partition state explicitly and test rapid switches and delayed encryption/decryption completion.

[Unkeyed page](https://github.com/AJahann/cipher/blob/8d281a33cfac772317862cf60c2a210f5f7d216b/apps/web/src/components/chat-layout.tsx#L72-L80) · [Outbox and composer](https://github.com/AJahann/cipher/blob/8d281a33cfac772317862cf60c2a210f5f7d216b/apps/web/src/components/chat-page.tsx#L137-L195)

### 4. High maintenance priority — vulnerable Next.js version is pinned

Next.js is pinned to 16.3.2. The package audit reports three critical advisories affecting that version:

- Windows-hosted server RCE, patched in 16.3.3. This prerequisite was not present in the Linux review environment.
- AVIF image-optimization RCE, patched in 16.3.3. No attacker-controlled image ingestion route was established during this review.
- Node `next/og` ImageResponse RCE with attacker-controlled SVG values, patched in 16.3.6. No `next/og` or ImageResponse use was found in application source.

Thus: **vulnerable dependency version confirmed; application RCE not demonstrated**. Other Next advisories in the audit require 16.3.8. Upgrade to at least 16.3.8 or a newer supported patched release, regenerate the lockfile, audit again, and address remaining transitive `sharp`/`source-map-js` findings. Remove unused `ts-node-dev` if it is genuinely unnecessary rather than retaining its old transitive graph.

[Windows advisory](https://github.com/advisories/GHSA-p293-qw3h-jr36) · [AVIF advisory](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4) · [ImageResponse advisory](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j)

### 5. Medium — persistence success and realtime delivery failure do not recover together

**Reproduced with fault injection.** The handler inserts a message before completing notification work. For a newly created conversation whose recipient was already connected, injecting a failure in `getConversationMembers()` after insertion produced an INTERNAL failure acknowledgment. Retrying the identical command returned success with `replayed: true`, but the recipient received **zero** message/notification events across both attempts.

The stored message is not deleted: HTTP history can recover it. The failure is a mismatch between persistence, reported send status, and live notification recovery. The comment that a replay means every member already received the message is not a valid delivery guarantee.

Fix with an outbox/delivery mechanism appropriate to the product: acknowledge persistence separately from receipt; make replay safe to re-notify with client deduplication; or use a transactional outbox. Pair that with history catch-up on reconnect. Test faults between insert, room joins, notification, and acknowledgment.

[Persistence and broadcast ordering](https://github.com/AJahann/cipher/blob/8d281a33cfac772317862cf60c2a210f5f7d216b/packages/api/src/modules/chat/chat.socket.ts#L124-L176)

### 6. Medium — socket reconnect only refreshes contacts, not message history

**Source-confirmed; not separately reproduced as an end-to-end network outage.** `useChatRealtimeSync` invalidates only the user directory on `connect`. Socket.IO connection recovery is not configured, and there is no explicit message catch-up here. An existing unit test asserts that only contacts are invalidated.

If the transport drops while the browser remains nominally online, messages sent during that gap may remain absent until another trigger refetches history. TanStack Query's browser-online/window-focus behavior can mask this; it is not a substitute for a transport-reconnect contract.

Refresh relevant histories and conversations on reconnection, or synchronize after a durable server watermark. Test transport-only disconnects with the page still focused and online. Once history pagination is implemented, merge catch-up results without losing older pages.

[Reconnect logic](https://github.com/AJahann/cipher/blob/8d281a33cfac772317862cf60c2a210f5f7d216b/apps/web/src/lib/data-layer/chats/use-chat-socket.ts#L218-L249)

### 7. Medium hardening — WebSocket origin is not enforced

**Server behavior reproduced.** A WebSocket-only client carrying a valid synthetic session cookie connected with `Origin: https://untrusted.example`. Configured CORS does not constitute a WebSocket handshake Origin policy.

This is not proof that an arbitrary third-party website can steal a session: browser SameSite cookie behavior, site topology, and cookie availability matter. Same-site hostile origins deserve particular attention.

Reject unapproved browser origins in Socket.IO/Engine.IO handshake admission, and explicitly decide whether non-browser clients without Origin are supported. Add allowed, disallowed, and missing-Origin handshake tests. Audit normal mutation routes' CSRF policy rather than assuming CORS is an authorization control.

[Socket server configuration](https://github.com/AJahann/cipher/blob/8d281a33cfac772317862cf60c2a210f5f7d216b/packages/api/src/app.ts#L73-L82)

## Encryption: what is and is not promised

Positive: the code uses libsodium rather than inventing primitives; fresh nonces and salts are generated; private keys are wrapped with Argon2id plus authenticated encryption; wrong-key/tampering behavior has tests; raw private keys are kept out of intentional API payloads.

Important boundaries:

1. **This is not zero-knowledge against the API at authentication time.** The same password protects the private-key bundle and is sent to the API for bcrypt authentication. A compromised or malicious API can capture that password and unwrap the bundle. Client-side encryption here should not be described as preventing that server threat. Separate secrets or a professionally designed password-authentication/key-recovery protocol would be necessary for a stronger claim.
2. **Peer keys are trusted from the server.** No fingerprint verification, trust-on-first-use warning, or key-transparency mechanism was found. Active server key substitution is outside the protection provided by the present directory.
3. **No forward secrecy / ratchet.** Static long-term key pairs protect messages. Later compromise of a private key can expose recorded corresponding history; this is not a Signal-like session protocol.
4. **Metadata is outside the encrypted plaintext.** Sender IDs, conversation IDs, and command IDs are not included in a checked encrypted envelope. A future protocol should bind context and version, define replay rules, and verify claimed sender/recipient semantics.
5. **Decryption failures disappear silently.** `decryptOne()` returns null on error and the list filters those results out. Prefer an explicit undecryptable-message placeholder and key/error state so corruption or key problems are distinguishable from no history.
6. **Key material lifecycle can improve.** Clearing the module variable does not overwrite the prior byte array; derived wrapping keys are not explicitly wiped. Best-effort wiping is useful, but JavaScript garbage collection cannot promise perfect secret erasure. Serialize KDF/protocol parameters and versions to make future migrations explicit.

[Encryption](https://github.com/AJahann/cipher/blob/8d281a33cfac772317862cf60c2a210f5f7d216b/packages/shared/src/crypto/e2e.ts) · [Wrapping](https://github.com/AJahann/cipher/blob/8d281a33cfac772317862cf60c2a210f5f7d216b/packages/shared/src/crypto/keys.ts) · [Hidden decryption failures](https://github.com/AJahann/cipher/blob/8d281a33cfac772317862cf60c2a210f5f7d216b/apps/web/src/components/chat-page.tsx#L55-L80)

## Other production-readiness gaps

- No application-level rate limiting was found for registration, login, or socket event frequency. Add bounded work/abuse controls; edge controls may exist outside this repository, but none were verified.
- `/auth/login` returns the encrypted private-key bundle without the explicit `no-store` applied to `/auth/key-bundle`. Apply a consistent sensitive-response policy.
- The logout hook removes only the `me` query; it does not clear encryption keys, all account-scoped queries, or the socket. It is currently not wired into a visible logout flow in the inspected application. Build one coordinated teardown path rather than relying on the HTTP call alone.
- Users are truncated to the first 100 directory entries in the current UI; message history defaults to the newest 50 and discards `nextCursor`. These are documented limitations, but they become visible product failures as usage grows. Carry pagination through the hooks and UI.
- Socket code logs the raw session ID at info level. Avoid logging session identifiers even though a raw unsigned ID alone is not the complete signed browser cookie.
- Presence broadcasts offline whenever any tab disconnects, even if another socket for the user remains connected. Correct that before exposing it as reliable peer status.
- In-memory Socket.IO rooms are single-instance. Horizontal scaling needs a compatible adapter and cross-node revocation/broadcast design; shared PostgreSQL sessions alone do not provide that.
- CI unit/E2E jobs require `CI_ENV_FILE` repository secrets. Fork pull requests without secrets will fail before meaningful tests. Use isolated non-secret CI configuration where possible.
- README installation requirements mention older pnpm versions while package engines require 12.6.0; align setup documentation.

## What is worth preserving

- Membership checks on messages, history, reads, and conversation joining.
- Database-enforced unique direct conversations and per-sender message command IDs.
- Transactional registration and DM creation.
- Keyset pagination that keeps timestamp precision inside PostgreSQL and uses a deterministic tie-breaker.
- Explicit GitHub linking rather than implicit identity merging; stable provider ID, server-side flow storage, PKCE, bounded expiry, atomic consume, and token non-persistence.
- Narrow service/controller boundaries and shared contracts.
- Existing accessibility, component, hook, crypto, and PostgreSQL integration testing.

## Suggested implementation order

1. Update vulnerable dependencies and establish a reproducible green check baseline.
2. Revoke authority across HTTP and sockets; coordinate client logout/key/cache teardown.
3. Resolve bcrypt/passphrase semantics with an explicit migration path.
4. Scope composer, decrypted state, and outbox by account and conversation.
5. Add replay-safe delivery recovery and transport-reconnect history reconciliation.
6. Enforce origin/abuse policies and surface cryptographic failures.
7. Complete pagination and operational/multi-instance behavior.
8. Decide and document the intended cryptographic threat model before adding recovery, key rotation, or multi-device features.

Keep the present architecture. These changes are clearer and lower-risk than adding more layers or rewriting the application.
