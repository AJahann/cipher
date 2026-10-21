# Remediation validation

## Reproducible baseline

- Original review: `8d281a3`.
- Implementation base: `c8c2507`, preserving intervening GitHub availability/link-status fixes.
- Integration branch: `remediation/security-reliability`.
- Sub-branch PRs: #25 baseline/dependencies, #26 auth/transport, #27 client isolation, #28 delivery/history, #29 crypto lifecycle, #30 final verification.

## Local acceptance

- Frozen-lockfile installation: passed with pnpm 12.6.0 / Node 24.14.1.
- Full Vitest suite with disposable PostgreSQL: **175 passed, 31 files**. This includes session/OAuth tests and live socket revocation, rotation, expiry, Origin, and post-insert failure/replay tests.
- All workspace type checks: passed.
- Production build: passed with Next.js 16.4.2.
- Chromium Playwright: **14 passed**, including setup, encrypted send/receive, contacts, unlock, GitHub availability, accessibility, confirmed contact-switch draft isolation, and full sign-out/cookie replay rejection.
- Biome formatting: passed.
- Production dependency audit: **zero advisories** at verification time.
- Native lint rules: **zero warnings/errors**, including `--deny-warnings`.

The sandbox's Oxlint JavaScript-plugin bridge panics in its allocator (both 1.85 and 1.89); the production configuration has **not** been weakened. Native rules were checked through an equivalent flattened configuration preserving all native rule options. Complete plugin-enabled lint, along with the other acceptance jobs, is checked independently on GitHub's normal runner. Hosted results are recorded below once complete.

## Regression coverage added

- Full-password Argon2id behavior, UTF-8 suffix distinctions, safe short bcrypt upgrade, and refusal of ambiguous boundary credentials.
- Bounded limiter cardinality and reset behavior.
- Logout/rotation socket revocation, sensitive-event revalidation, idle expiry and strict handshake Origins.
- Fault injected after message insert: retry re-notifies the recipient and stores only one row.
- Conversation drafts/failed outboxes do not appear under a different contact; cancelling discard preserves the draft.
- Query/key/socket cleanup and non-looping cross-tab notification.
- Cursor directory/history traversal, ordering and boundary deduplication; transport reconnect reconciles history.
- Envelope routing-field tampering, reflection, algorithm downgrade and unsupported algorithms.
- Versioned key bundles, legacy recovery, rejection of unbounded/unknown KDF metadata, and visible decryption failures.

## Limits of verification

Only disposable local/CI data was used. No production systems, credentials, or destructive production migrations were involved. Firefox/WebKit, load testing, operational restore drills, formal cryptographic verification and independent security audit were not performed. Compatibility/threat-model limits are documented in `SECURITY-ARCHITECTURE.md`; zero-knowledge authentication, ratcheting/forward secrecy, audited key transparency, automated ambiguous-password recovery and horizontal scaling are not claimed.

## Hosted acceptance

Verification PR #30, commit `5153957de7f82af54dc382562149b1e4d526cacd`: **all six GitHub checks passed** — Format, Lint (including JavaScript plugins and denial of warnings), Typecheck, Unit Tests, Build, and PostgreSQL-backed Chromium E2E. This independently verifies the complete lint policy despite the sandbox-only plugin allocator failure.

The final integration PR is merged into main only after its acceptance checks pass. This record describes the code acceptance baseline; subsequent documentation-only updates do not change runtime behavior.

## Integration-check reliability

The first final-integration runs intermittently failed in the PostgreSQL API step despite earlier green checks and a passing local CI-environment reproduction. Follow-up PR #32 enables GitHub failure annotations (rather than hiding details in runner logs) and serializes the API fixture files that migrate/inspect a shared disposable schema. It does not skip assertions, retry failed tests, or relax application security checks. The root cause of those initial runs was not established; subsequent acceptance results, rather than an assumed diagnosis, gate the final merge.
