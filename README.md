# cipher

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
