# ADR 0001: Fix lifecycle boundaries without inventing a new cryptographic protocol

Status: accepted for this remediation.

## Context

Cipher is an educational one-to-one encrypted messenger. Review found lifecycle errors at HTTP/socket, contact-switch, persistence/notification, and password-hash boundaries. Shared contracts and database invariants remain useful and do not require a rewrite.

## Decisions

- Keep Fastify, Socket.IO, Drizzle, Next.js and TanStack Query.
- Treat session revocation as authority revocation across transports; a socket connection is not permanent authorization. Revalidate sensitive events and bound idle validity.
- Use Argon2id for new account hashes. Upgrade safe legacy bcrypt credentials after login. Refuse automatic migration of >72-byte legacy credentials: bcrypt cannot tell which suffix was originally chosen. Do not silently reset a passphrase or claim an admin can recover encrypted history.
- Isolate plaintext/composer/outbox state by identity and conversation. Pending messages are in memory and can be lost on navigation/reload; communicate this rather than leaking them into another conversation. Durable encrypted outboxes are separate work.
- Persistence ACK means stored, not peer-delivered. Retries may notify again; clients deduplicate by persisted message ID. HTTP catch-up is the durable recovery path.
- Bind new encrypted plaintext to sender, recipient, conversation and command IDs. Continue reading legacy payloads explicitly; do not claim this gives old messages new guarantees.
- Preserve legacy key bundles and encode new KDF versions/parameters. Wipe byte arrays on best-effort cleanup, with no claim of guaranteed JavaScript erasure.
- Keep browser-delivered cryptography's actual threat model explicit: the API sees the wrapping password on normal login/registration, the server supplies peer keys, and long-term keys do not provide forward secrecy.
- Ship as a single API instance. Do not pretend a local limiter or in-memory room map coordinates multiple instances; distributed adapters/revocation/limiting are required before scaling.

## Consequences

The implementation can close reproducible lifecycle flaws while retaining compatibility. Already-overlong bcrypt credentials need an explicit, separately designed recovery/migration process; no arbitrary suffix may become authoritative. No home-grown PAKE, ratchet, or account recovery protocol is introduced.
