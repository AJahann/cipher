# Security and reliability remediation

## Branch and review policy

The integration branch is `remediation/security-reliability`. Each phase is implemented in a separate `remediation/phase-*` branch, reviewed as a pull request into the integration branch, and merged there. Only the tested integrated result is proposed for merge into `main`. Preserve changes already on main; do not force-push or bypass branch protection.

Baseline: code review of `8d281a3`, implementation rebased onto `c8c2507` to preserve GitHub availability/linking improvements. The original report is historical evidence, not a claim that its findings remain unfixed.

## Phases

1. **Baseline and dependencies** — check in the review, architectural decisions, and this roadmap; update vulnerable dependency graph; add Argon2id runtime dependency.
2. **Authentication and transport** — full-password hashing with explicit bcrypt migration policy; revoke sockets on logout/rotation and revalidate events/expiry; handshake Origin admission; bounded authentication/socket work; sensitive-response cache policy; redact session identifiers.
3. **Client identity and conversation isolation** — conversation-keyed state; coordinated logout/key/cache/socket cleanup; account-scoped caches; regression coverage for switching contacts.
4. **Delivery and history** — replay-safe live notifications, reconnect reconciliation, directory/history pagination and bounded page-cache updates; regression tests for post-insert failure and transport reconnect.
5. **Cryptographic UX and lifecycle** — version/context-bound plaintext envelope with backward-compatible legacy reads, explicit undecryptable placeholders, explicit KDF format/parameters, best-effort key wiping, documented trust boundaries.
6. **Verification and operations** — secret-free disposable CI configuration, deterministic test environment, integration/browser regression coverage, deployment/scaling limits and final validation record.

## Acceptance gates

- Frozen-lockfile install, formatting, lint, all workspace types, production build.
- Unit/component tests plus PostgreSQL-backed session/OAuth/message tests.
- Chromium end-to-end auth, contacts, encryption, unlocking, pagination and isolation regressions.
- No critical/high production dependency advisories, or explicit reviewed justification.
- No production credentials, production data, destructive resets, or unrelated changes.

## Deliberately not promised by this work

A ratcheting/forward-secret protocol, zero-knowledge authentication, audited key transparency, automated recovery of already-ambiguous legacy bcrypt passphrases, and horizontal scaling are protocol/operational projects, not safe incidental refactors. See the decisions and security architecture documents for the supported boundary and migration behavior.

## Completion record

- Phase 1: dependency baseline and checked-in review — PR #25.
- Phase 2: authentication/transport authority — PR #26.
- Phase 3: client identity and conversation isolation — PR #27.
- Phase 4: delivery recovery and paginated history — PR #28.
- Phase 5: crypto compatibility/lifecycle and security architecture — PR #29.
- Phase 6: secret-free CI, regression tests, style/type verification and final acceptance — verification branch.

Local integrated acceptance so far: 175 tests passed against PostgreSQL; all workspace types and Biome formatting passed; zero production dependency advisories. Native lint policy passes with zero warnings; the sandbox's JS-plugin bridge crashes, so the complete lint policy is checked independently in GitHub CI. The final build/browser and hosted checks are recorded in `VALIDATION.md` before the integration branch is merged to main.

Remaining protocol/operational projects are explicit in `SECURITY-ARCHITECTURE.md`; they are not claimed as implemented or audited.
