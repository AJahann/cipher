# Security architecture and residual limits

## Scope

Cipher is an educational, single-instance encrypted messenger, not an independently audited secure communications system. Follow `ROADMAP.md` and ADR 0001 for the remediation history. HTTPS is required for deployment.

## Authority and revocation

HTTP sessions are stored in PostgreSQL, rotated on authentication, and destroyed on logout. Socket handshakes require the configured browser Origin and a valid signed session cookie. Each socket joins a session-scoped room. Logout and session rotation disconnect that local room immediately; sensitive events reload session authority; idle sockets on any API instance are checked every five seconds and disconnected on expiry or store failure. The bounded idle interval is an explicit receive-authority window, not instantaneous distributed revocation.

Session saves and destruction serialize by session ID using a PostgreSQL transaction-scoped advisory lock. Destruction atomically records the ID in `session_revocations` and deletes its `user_sessions` row. Later rolling or explicit saves for that ID cannot recreate authority. Session IDs are not reused. Valid sessions retain rolling seven-day expiry; this does not cancel work already authorized before revocation.

Apply migration `0005_session_revocations` before starting the updated API. Drain/stop old API processes before rollout: old binaries do not participate in the revocation lock or tombstone checks. Revocation records are intentionally permanent and are not removed by expired-session pruning; storage grows with revoked IDs. Do not add time-based tombstone pruning without a reviewed bound on stale writers. No request-time schema creation is introduced.

Local IP, per-account event, and hash-concurrency limits bound work on a single API process. They are not distributed controls. All HTTP mutations with a present Origin must match CLIENT_ORIGIN; non-browser HTTP clients without Origin remain supported, while WebSocket handshakes without Origin are refused. Configure the proxy and CLIENT_ORIGIN consistently; do not trust arbitrary forwarded client-IP headers.

## Password migration

New account hashes use Argon2id with 19 MiB memory, two passes and one lane. This is separate from browser key wrapping. The encoded hash carries its algorithm and parameters. Correct legacy bcrypt credentials shorter than 72 UTF-8 bytes are rehashed after login using a conditional update. Matching credentials at or beyond 72 bytes return LEGACY_PASSWORD_AMBIGUOUS and are **not** automatically migrated: bcrypt cannot identify the original suffix, and an exactly-72-byte prefix may match a longer password.

There is no automated recovery/reset feature in this patch. Do not tell users to truncate credentials or overwrite an encrypted key bundle. Preserve any already-unlocked device and design a reviewed migration/recovery path before changing that account's authentication or encryption material. Lost original wrapping passphrases may make history unrecoverable.

## Encryption and compatibility

New messages use libsodium crypto_box with the `cipher-v1-x25519-xsalsa20-poly1305` algorithm marker. Authenticated plaintext begins with reserved prefix `cipher:v1:` and contains version, sender ID, recipient ID, conversation ID, client command ID, and text. Decryption verifies each field against expected context. Relabeling the outer algorithm as legacy is rejected when the decrypted prefix identifies a new envelope. Command IDs are stable for retries. Duplicate history rows are deduplicated by persisted message ID.

Existing `x25519-xsalsa20-poly1305` messages remain readable; they have no authenticated routing envelope. An old plaintext beginning with the newly reserved prefix is rejected rather than silently granting new-format semantics. Unsupported or invalid messages stay visible as undecryptable placeholders, and missing keys produce explicit errors. Neither behavior repairs missing/corrupt keys.

New private-key bundles encode version 1, Argon2id13, two operations and 64 MiB memory. Those values are pinned and validated before derivation, including on untrusted bundles; callers cannot request arbitrary resource costs. Legacy versionless bundles use the same explicit historical parameters. Wiping mutable key buffers and dropping references is best effort only; JavaScript strings, engine copies and garbage collection prevent guaranteed erasure.

## Threats this does not solve

- The API receives the same password used to wrap keys during normal registration/login. A malicious or compromised API can capture it and unwrap the stored bundle. This is not zero-knowledge authentication or key recovery.
- Peer keys are supplied by the server. No audited fingerprint verification, key transparency, or out-of-band safety-number flow is shipped here.
- Static keys do not provide forward secrecy, a double ratchet, post-compromise security, or independently authenticated multi-device sessions.
- A malicious server can omit/delay messages, replay legacy ciphertext, and observe metadata. Context binding does not provide complete transcript ordering or prove global absence of replays.
- XSS or a compromised browser origin can access live plaintext/keys. Browser JavaScript delivered by a malicious host can replace the encryption implementation.

## Client state and delivery

Conversation components are keyed by account and conversation. Switching with a draft/pending outbox requires discard confirmation; pending plaintext is not a durable offline queue. Sign-out cancels query work, clears account caches and key storage, disconnects the socket, and reloads the public page. Identity changes notify other tabs to clear local state.

Stored ciphertext is durable history, not proof of peer receipt. Message and notification intent commit atomically before a successful send acknowledgement; notification failures are retried asynchronously and do not turn durable acceptance into a peer-delivery claim. Retrying the original command ID/ciphertext returns the same message and does not create another logical notification intent. Disconnects require HTTP history reconciliation on reconnect; the client refreshes conversations, contacts and loaded histories. Cursor pages remain authoritative and realtime updates invalidate rather than append into old pages. Duplicate hints across worker crash recovery converge by persisted message ID; no peer-delivery watermark is claimed.

## Deployment boundaries

Day 19 adds optional Redis directory copies and cross-instance presence leases,
not a distributed message adapter or distributed abuse controls. Presence is
unknown during shared-state uncertainty and never grants message-receive
authority. See [cache coherence, lease guarantees, and two-process acceptance](day-19-redis.md).

Run one API instance unless you implement and test a Socket.IO adapter, distributed session revocation, globally coordinated abuse controls, and catch-up semantics. In-memory rooms and local limits do not become distributed just because sessions use PostgreSQL. Keep auth responses out of caches and avoid logging session IDs, tokens, passwords, private keys or OAuth callback queries. Configure trusted TLS termination, database backups/restore drills, monitoring, and graceful process shutdown before sensitive deployment.

## Day 20 asynchronous notification boundary

Message and notification intent now commit atomically in PostgreSQL; successful
send acknowledgements mean durable acceptance, not peer delivery/read. The
BullMQ consumer shares the single messenger API's in-memory Socket.IO server,
checks current membership/session authority before emission, and retains terminal
failures for operator re-drive. Duplicate notification hints are possible across
crash recovery; persisted message IDs and client history reconciliation converge.
Only cache/presence remain cross-instance. Do not run this consumer on multiple
message API instances without implementing a delivery bridge. See
[Day 20 design and operations](day-20-jobs.md) for finite retries, PostgreSQL
reconciliation after Redis loss, retention, and deployment assumptions.

## Day 21 input, authority and cost boundaries

See [the inspected boundary inventory, concrete local IP/account budgets, abuse
tests and code-linked OWASP threat statuses](day-21-security.md). HTTP admission
now precedes avoidable parsing/session/hash work; authenticated reads and
conversation creation have account budgets shared across tabs/sessions, and
socket work remains shared across reconnects. Explicit body/Engine.IO ceilings,
live-connection caps and infrastructure payload checks bound selected costs.
These are process-local controls, not a global DoS defense or a security audit.
Absent-Origin HTTP support remains deliberate; forwarded IP is not trusted.
The malicious-server, server-supplied-key and browser-compromise limitations above
remain open.
