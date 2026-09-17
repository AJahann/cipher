# cipher

[![CI](https://github.com/AJahann/cipher/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/AJahann/cipher/actions/workflows/ci.yml)

End-to-end encrypted chat. Keys are generated and never leave the client.

## Stack

- **Next.js 16** · **React 19** · **Tailwind v4**
- **Socket.io** for real-time messaging
- **TanStack Query** for server state
- **ECDH + AES-GCM** for E2E encryption via Web Crypto API
- **pnpm workspaces** monorepo

## Structure

```
apps/
  web/                  Next.js app

packages/
  shared/               Encryption logic, API types, Zod schemas
  ui-tokens/            Design tokens — CSS variables + typed TS constants
  ui-web/               React component library (consumes ui-tokens)
```

## Getting started

```bash
pnpm install
pnpm --filter web dev
```

## Testing

The test suite is split into fast, isolated Vitest checks and full-stack Playwright checks. Each layer owns a different kind of confidence; passing a lower layer does not replace the layers above it.

### Unit tests

The pure unit tests prove that the cryptographic primitives behave correctly without an application server or database:

- byte arrays survive base64 encode/decode, including empty values;
- private keys can be wrapped and unwrapped with the correct passphrase;
- wrong passphrases and modified wrapped-key ciphertext are rejected;
- every key wrap uses a fresh salt, nonce, and ciphertext;
- two generated key pairs can encrypt and decrypt messages;
- Unicode and empty messages round-trip correctly; and
- wrong recipient keys and modified message ciphertext are rejected.

These tests exercise the real crypto implementation. They do not prove browser UI behavior, persistence, transport, or that the server never receives plaintext; those boundaries are covered separately.

### Component and hook tests

Component tests render real React components in jsdom and interact with them through accessible roles and labels. They prove:

- `AuthForm` submits login values, switches to registration mode, and rejects mismatched passphrases;
- `ChatInput` has an accessible send action, disables empty submissions, sends by click or Enter, and preserves Shift+Enter; and
- `Button` exposes an accessible name and enforces loading, disabled, and custom loading-text behavior.

Hook tests render the real TanStack Query hooks with a real `QueryClient`. They prove pending, success, and error states; request paths and query parameters; retry rules; stale-time and remount behavior; cache sharing and isolation; query-key changes; and conversation-list invalidation after a successful mutation. `useMe` also proves that authentication failures are not retried.

### End-to-end specs

Playwright registers unique Alice and Bob users, stores their authenticated browser state, and explicitly unlocks the in-memory private key when a scenario needs encrypted operations.

| Spec | What it proves |
| --- | --- |
| `auth.spec.ts` | Two unlocked users can open a conversation, send a message through the live stack, and observe it from the receiving browser. |
| `contacts.spec.ts` | Registered and unlocked users become visible to each other in the conversation sidebar without first sending a message. |
| `unlock.spec.ts` | Restoring cookies and local storage is not sufficient to restore the in-memory private key; the passphrase unlock step is required before chat becomes available. |

### Mocking boundaries

| Layer | Real | Mocked or replaced |
| --- | --- | --- |
| Crypto unit tests | Crypto implementation and runtime cryptographic operations | No application server, browser UI, database, or network |
| Component tests | React components, state updates, validation, accessibility, and user events | Parent callbacks are spies; no backend or network |
| Hook tests | Hooks, TanStack Query, cache behavior, request construction, and state transitions | MSW intercepts HTTP and returns deterministic API responses; no API process, database, or Socket.io server |
| Playwright E2E | Chromium, Next.js, API process, HTTP, Socket.io, crypto, migrations, and PostgreSQL | No application API mocks; CI supplies an ephemeral PostgreSQL container and generated test users |

The web-test MSW server rejects unhandled requests. A new request therefore requires an explicit handler or the test fails instead of silently reaching a real backend.

### Why E2E uses real processes and network boundaries

Playwright starts the monorepo with `pnpm dev` and drives the application from Chromium through `PLAYWRIGHT_BASE_URL`. Requests cross the same browser-to-Next.js, API, Socket.io, and PostgreSQL boundaries used by the running product. E2E tests intentionally do not use MSW: their purpose is to catch integration failures in routing, cookies, sessions, serialization, database migrations, real-time delivery, and browser-only cryptography that isolated tests cannot observe.

CI uses a fresh PostgreSQL service container and applies Drizzle migrations before running E2E. This keeps the environment isolated and repeatable without sharing production infrastructure.

### Coverage policy

The target is at least **80%** for statements, branches, functions, and lines across code measured by the Vitest suite. CI publishes text, JSON summary, LCOV, and HTML reports. The target is a review requirement; CI currently reports coverage but does not enforce a numeric threshold.

Coverage excludes:

- dependencies under `node_modules`;
- generated build output under `dist`;
- TypeScript declaration files (`*.d.ts`); and
- test support directories matching `**/test/**`.

Coverage is a signal, not a substitute for assertions at meaningful security and product boundaries.

### Flake policy

- Vitest failures are not retried; unit, component, and hook tests must be deterministic.
- Playwright uses one worker in CI to avoid collisions through shared backend state.
- Playwright may retry a failed E2E test twice to collect diagnostics. A test that passes only on retry is still considered flaky and must be investigated.
- Do not fix flakes by increasing retries, adding fixed sleeps, or using `waitForTimeout`. Wait for observable UI or network state instead.
- Test users must remain unique per run, and tests must not depend on execution order or production data.
- On failure, inspect the retained trace, screenshot, video, and HTML report before changing timing behavior.

### Run the CI jobs locally

Both jobs expect a valid `.env` at the monorepo root. Use dedicated local/test credentials, never production secrets.

Unit job:

```bash
pnpm install --frozen-lockfile
pnpm exec vitest run \
  --coverage \
  --coverage.reporter=text \
  --coverage.reporter=json-summary \
  --coverage.reporter=lcov \
  --coverage.reporter=html
```

E2E job with the same disposable PostgreSQL shape used in CI:

```bash
docker run --rm --detach \
  --name cipher-test-db \
  --env POSTGRES_USER=cipher \
  --env POSTGRES_PASSWORD=cipher \
  --env POSTGRES_DB=cipher_test \
  --publish 5432:5432 \
  postgres:16-alpine

export DATABASE_URL='postgresql://cipher:cipher@127.0.0.1:5432/cipher_test'

pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm --filter @chat-app/api exec drizzle-kit migrate
pnpm --filter web build
CI=true pnpm test:e2e --project=chromium

docker stop cipher-test-db
```

If PostgreSQL is already available locally, point `DATABASE_URL` at an isolated test database and skip the Docker commands.

Useful interactive commands:

```bash
pnpm test:unit:watch
pnpm test:e2e:headed --project=chromium
pnpm test:e2e:debug --project=chromium
pnpm test:e2e:report
```

## How encryption works

1. On register — an ECDH key pair is derived from the user's passphrase via PBKDF2, the private key is AES-GCM wrapped and stored server-side, the public key is stored in plaintext.
2. On login — the wrapped private key is fetched and unwrapped in-browser using the passphrase. The raw private key never touches the server.
3. Messages are encrypted client-side with the recipient's public key before sending. The server stores and forwards ciphertext only.

## Packages

### `@chat-app/ui-tokens`

Zero dependencies. Exports CSS custom properties (`tokens.css`) and typed TS constants for colors, spacing, and typography. Consumed by `ui-web` and imported directly into `globals.css`.

### `@chat-app/ui-web`

React component library. No business logic — all data hooks and crypto stay in `apps/web`. Components receive data and handlers as props. Tailwind classes are scanned from `apps/web` via `@source` in `globals.css`.

### `@chat-app/shared`

Shared between web and any future API package. Contains the encryption primitives, Zod schemas, and TypeScript types that both sides agree on.

## Adding React Native later

1. Add `apps/mobile` (Expo)
2. Add `packages/ui-native` — same component API as `ui-web`, rendered with `StyleSheet`
3. `packages/shared` and `packages/ui-tokens` (TS constants only) are already cross-platform
