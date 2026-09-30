# Cipher

[![CI](https://github.com/Ajahann/Cipher/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Ajahann/Cipher/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Cipher is a real-time, end-to-end encrypted chat application. It encrypts messages in the browser before they are sent, while the backend handles authentication, public-key discovery, encrypted-message persistence, and live delivery.

> [!IMPORTANT]
> Cipher is an educational project and has not undergone an independent security audit. Do not use it for sensitive production communication without a professional review.

## Features

- End-to-end encrypted one-to-one messages
- Real-time message delivery with Socket.IO
- Account registration and session-based authentication
- User directory for discovering contacts
- Password-protected private-key recovery
- Responsive web interface and reusable component library
- Unit, component, hook, and browser end-to-end tests
- Automated CI with PostgreSQL-backed integration tests

## How it works

1. **Registration:** the browser generates an X25519 key pair.
2. **Key protection:** the private key is encrypted with a key derived from the user's password using Argon2id. The server stores only the public key and the encrypted private-key bundle.
3. **Unlock:** after login, the encrypted private key is returned to the browser and unlocked locally with the user's password.
4. **Sending:** the browser encrypts each message for its recipient using libsodium's authenticated public-key encryption (`X25519-XSalsa20-Poly1305`).
5. **Delivery:** the API stores and forwards ciphertext. Decryption happens in the recipient's browser.

The unlocked private key is kept in browser memory for the active session. Use HTTPS in every deployed environment because credentials and encrypted payloads still travel through the API.

## Tech stack

| Area | Technologies |
| --- | --- |
| Web | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| Client state | TanStack Query |
| API | Fastify 5, Socket.IO |
| Database | PostgreSQL, Drizzle ORM |
| Authentication | Server-side sessions, bcrypt |
| Cryptography | libsodium, Argon2id, X25519-XSalsa20-Poly1305 |
| Testing | Vitest, Testing Library, MSW, Playwright |
| Workspace | pnpm workspaces |

## Project structure

```text
Cipher/
├── apps/
│   └── web/              # Next.js client
├── packages/
│   ├── api/              # Fastify API, Socket.IO, Drizzle schema and migrations
│   ├── shared/           # Encryption, shared types and validation schemas
│   ├── ui-tokens/        # Shared design tokens
│   └── ui-web/           # Reusable React components
├── docs/                 # Engineering notes and audits
├── playwright.config.ts  # End-to-end test configuration
└── vitest.config.mjs     # Unit and component test configuration
```

## Requirements

- Node.js 20 or newer
- pnpm 9 or newer
- PostgreSQL 16 recommended

## Getting started

### 1. Clone the repository

```bash
git clone https://github.com/Ajahann/Cipher.git
cd Cipher
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure the environment

```bash
cp .env.example .env
```

Set the following values in `.env`:

| Variable | Purpose | Local example |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://cipher:cipher@localhost:5432/cipher` |
| `SESSION_SECRET` | Secret used to sign sessions; use at least 32 characters | Generate a strong random value |
| `NODE_ENV` | Runtime environment | `development` |
| `BACKEND_PORT` | API and Socket.IO port | `3001` |
| `NEXT_PUBLIC_API_URL` | API URL used by the web app | `http://localhost:3001` |
| `CLIENT_ORIGIN` | Allowed web origin | `http://localhost:3000` |
| `PLAYWRIGHT_BASE_URL` | URL used by Playwright | `http://localhost:3000` |

### 4. Prepare the database

Create the PostgreSQL database, then apply the included migrations:

```bash
pnpm --filter @chat-app/api exec drizzle-kit migrate
```

### 5. Start development

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The API uses the port configured by `BACKEND_PORT`.

## Available commands

| Command | Description |
| --- | --- |
| `pnpm dev` | Start all workspace development servers |
| `pnpm build` | Build all packages and applications |
| `pnpm start` | Start all production servers |
| `pnpm lint` | Lint all workspaces |
| `pnpm format` | Format the codebase with Biome |
| `pnpm format:check` | Check formatting without writing changes |
| `pnpm typecheck` | Type-check every workspace package |
| `pnpm test:unit` | Run the Vitest suite |
| `pnpm test:unit:coverage` | Run unit tests with coverage |
| `pnpm test:e2e` | Run Playwright end-to-end tests |
| `pnpm test:e2e:headed` | Run end-to-end tests in a visible browser |
| `pnpm test:e2e:debug` | Open Playwright debug mode |
| `pnpm clean` | Remove dependencies, build output, reports, and caches |

## Testing

The test suite is split by responsibility:

- **Crypto unit tests** validate key wrapping, encryption, decryption, and tamper rejection.
- **Component tests** cover forms, message input behavior, loading states, and accessibility.
- **Hook tests** verify API requests and TanStack Query caching with MSW.
- **End-to-end tests** run the web app, API, Socket.IO, cryptography, migrations, and PostgreSQL together in Chromium.

Run the main suites locally:

```bash
pnpm test:unit
pnpm test:e2e --project=chromium
```

End-to-end tests require a configured test database and a valid root `.env` file. CI creates an isolated PostgreSQL service and applies migrations automatically.

## Security notes

- The server stores password hashes, public keys, encrypted private-key bundles, and encrypted messages.
- Private keys are generated and unwrapped in the browser; the raw private key is not intentionally sent to the server.
- A fresh salt and nonce are generated whenever a private key is wrapped.
- A fresh nonce is generated for every encrypted message.
- Losing the account password can make encrypted history unrecoverable.
- End-to-end encryption does not hide metadata such as account identities, conversation membership, message timing, or ciphertext size.

Please report suspected vulnerabilities privately to the repository owner instead of opening a public issue.

## Contributing

1. Fork the repository and create a feature branch.
2. Make a focused change with tests where appropriate.
3. Run `pnpm format`, `pnpm lint`, `pnpm typecheck`, and the relevant test suites.
4. Open a pull request describing the change and its motivation.

## License

Cipher is available under the [MIT License](LICENSE).
