# Security architecture and residual limits

## Scope

Cipher is an educational, single-instance encrypted messenger, not an independently audited secure communications system. Follow `ROADMAP.md` and ADR 0001 for the remediation history. HTTPS is required for deployment.

## Authority and revocation

HTTP sessions are stored in PostgreSQL, rotated on authentication, and destroyed on logout. Socket handshakes require the configured browser Origin and a valid signed session cookie. Each socket joins a session-scoped room. Logout and session rotation disconnect that room immediately; sensitive events reload session authority; idle sockets are checked every five seconds and disconnected on expiry or store failure. The bounded idle interval is an explicit receive-authority window, not instantaneous distributed revocation.

Local IP, per-account event, and hash-concurrency limits bound work on a single API process. They are not distributed controls. Browser auth mutations with an Origin must match CLIENT_ORIGIN; non-browser HTTP clients without Origin remain supported, while WebSocket handshakes without Origin are refused. Configure the proxy and CLIENT_ORIGIN consistently; do not trust arbitrary forwarded client-IP headers.

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

Stored ciphertext is durable history, not proof of peer receipt. If notification fails after insertion, the send may return an error despite persistence. Retrying the original command ID/ciphertext safely repeats notifications without inserting a second row. Disconnects require HTTP history reconciliation on reconnect; the client refreshes conversations, contacts and loaded histories. Cursor pages remain authoritative and realtime updates invalidate rather than append into old pages. This trades extra reads for simple correctness; a transactional outbox/watermark protocol is a future optimization.

## Deployment boundaries

Run one API instance unless you implement and test a Socket.IO adapter, distributed session revocation, globally coordinated abuse controls, and catch-up semantics. In-memory rooms and local limits do not become distributed just because sessions use PostgreSQL. Keep auth responses out of caches and avoid logging session IDs, tokens, passwords, private keys or OAuth callback queries. Configure trusted TLS termination, database backups/restore drills, monitoring, and graceful process shutdown before sensitive deployment.
