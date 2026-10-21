# Day 17 — Sign in with GitHub

## Account policy

Unknown GitHub identities are **refused**, with a message explaining how to link.
No keyless Cipher accounts are created, and accounts are never matched by GitHub
login or email. Sign in/register using the existing Cipher passphrase first,
then choose **Link GitHub to this Cipher account** in the conversation sidebar.
The binding is the stable numeric GitHub user id → existing `users.id`.
One GitHub identity per Cipher account; identities cannot be transferred or
silently replaced. Unlinking/account recovery is not implemented in this change.

## Flow and security boundaries

- `GET /auth/github` saves an anonymous/existing session and redirects to
  GitHub's authorization-code endpoint. Parameters: `client_id`, exact
  `redirect_uri`, `scope=read:user`, random `state`, `code_challenge`, and
  `code_challenge_method=S256`. No implicit flow or bearer token in a URL.
- `POST /auth/github/link` requires the existing session plus an exact
  `Origin: CLIENT_ORIGIN`. It returns an authorization URL for an explicitly
  requested link. Normal sign-in **never** implicitly links an identity, even
  when initiated with an authenticated cookie.
- State and PKCE verifier are independent 32-byte CSPRNG values. The verifier
  stays in PostgreSQL; only its SHA-256 challenge reaches the browser. The state
  is bound to the session id, expires after ten minutes, and is consumed with
  atomic `DELETE … RETURNING` before callback validation or network calls.
  Missing, mismatched, malformed, denied, expired, and failed callbacks consume
  their pending attempt too. Concurrent callbacks cannot both use a verifier.
  Starting another flow in the same session supersedes the previous flow.
- `GET /auth/github/callback` validates state, exchanges the one-time code with
  the server-only secret and verifier, and requests `GET https://api.github.com/user`
  with the bearer token. It retains only the stable user id; the token is not
  stored in a session, database, browser storage, response, URL, or log.
- Provider calls have timeouts, reject redirects, validate responses, and return
  sanitized errors. The API access-log serializer strips query strings. OAuth
  responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
  Configure reverse proxies/APM to exclude callback queries and sensitive request
  bodies/headers too; application code cannot control external access logging.
- Success awaits `session.regenerate()`, deletes the old store row (Day 16's
  adapter behavior), assigns the linked Cipher `userId`, saves, and redirects
  to the fixed app `/chat` URL. There is no JWT or parallel session mechanism.
- The GitHub bearer token is never a Cipher credential. Existing `requireAuth`
  and conversation membership checks are unchanged. GitHub authentication does
  not grant any conversation membership.
- GitHub does **not** unwrap the private key. `GET /auth/key-bundle` requires the
  Cipher session and returns only its user's public key and encrypted private
  key bundle. SessionGate replaces stale local bundles and requires the Cipher
  passphrase unless that same account is already unlocked in memory. A new
  browser is supported without pretending OAuth supplies an encryption secret.

## Deploy

1. Create a **GitHub OAuth App** for the environment. Set its callback to the
   API's exact `/auth/github/callback` URL, not the web app URL. Use separate
   apps/secrets for development and production.
2. Set these only in the **API deployment secret/config store**:

   ```text
   GITHUB_CLIENT_ID=<OAuth app client id>
   GITHUB_CLIENT_SECRET=<OAuth app client secret>
   GITHUB_REDIRECT_URI=https://api.example.com/auth/github/callback
   ```

   Local callback: `http://localhost:3001/auth/github/callback`. Production
   callbacks must use HTTPS. Never prefix these variables with `NEXT_PUBLIC_`.
   Leaving all three unset keeps password login available; GitHub endpoints
   fail closed with a configuration error. The frontend buttons remain visible.
3. Keep `CLIENT_ORIGIN` equal to the browser app origin, without a trailing
   slash, and `NEXT_PUBLIC_API_URL` pointing at the API. Use HTTPS and a same-site
   web/API deployment so the existing HttpOnly, Secure, SameSite=Lax session
   cookie works for top-level OAuth callbacks. Existing proxy/TLS trust settings
   must correctly identify HTTPS; do not weaken cookie security to work around it.
4. Apply migrations **before** restarting the API:

   ```bash
   pnpm --filter @chat-app/api exec drizzle-kit migrate
   ```

   Migration `0004_github_oauth` creates unique identity bindings and expiring
   session-bound attempts. The journal timestamp follows Day 16's timestamp so
   Drizzle does not skip it. Both tables cascade on account/session deletion.
5. Restart/deploy API and web. Sign in with a passphrase, link GitHub, then test
   GitHub sign-in in a fresh browser. Expect the passphrase unlock screen before
   reading/sending messages. Denial/unknown accounts return the existing JSON
   error envelope rather than leaving an authenticated partial account.

No OAuth client secret is included in the repository. The example contains
only commented variable names; tests use nonfunctional fixture credentials.

## Verification

Use a disposable PostgreSQL database, never production:

```bash
# Configure normal app environment and migrate the test database first.
pnpm --filter @chat-app/api exec drizzle-kit migrate
NEXT_PUBLIC_API_URL=http://localhost:3001 \
SESSION_TEST_DATABASE_URL=postgresql://user:password@localhost:5432/cipher_test \
  pnpm test:unit
pnpm typecheck
NEXT_PUBLIC_API_URL=http://localhost:3001 pnpm build
```

The normal PostgreSQL-backed CI step runs the OAuth integration suite alongside
Day 16's session tests. Without `SESSION_TEST_DATABASE_URL` those integration
suites are explicitly skipped. Provider HTTP is mocked; no real OAuth app secret
or GitHub account is needed for automated tests.

Coverage includes S256 and minimum scope; server-only secret/verifier; malformed,
missing, mismatched, cross-session, expired and replayed state; denial and code
validation; atomic concurrent callbacks; unknown identity refusal; explicit,
CSRF-protected linking and identity collision; session rotation and old-cookie
invalidation; own encrypted-key-bundle retrieval; conversation membership denial;
and the browser's separate passphrase-unlock gate.

Local verification: 122 tests pass against PostgreSQL 16 (no skipped tests),
all 9 Chromium browser regressions pass (including setup), formatting and the
production build pass, workspace typecheck passes, and Drizzle reports no schema
drift. Oxlint currently
panics in its allocator before producing diagnostics in this environment; this
is not a verified lint pass. A real GitHub consent/callback smoke test requires
the deployment's OAuth App credentials and has not been performed here.
