# Cipher API specification

The contract between `apps/web` and `packages/api`: every HTTP route in
`modules/auth`, `modules/user` and `modules/chat`, and every Socket.IO event in
`chat.socket.ts`. Payload schemas live in **`packages/shared/src/contracts`**
(zod) and are imported by both sides — Fastify parses with them, the web app
uses the `z.infer` types. If this document and those schemas disagree, the
schemas win and this document has a bug.

- [Conventions](#conventions)
- [HTTP routes](#http-routes)
- [Socket.IO](#socketio)
- [Pagination](#pagination)
- [Idempotency](#idempotency)
- [Data model](#data-model)
- [Known gaps](#known-gaps)

## Conventions

**Base URL.** `NEXT_PUBLIC_API_URL` (e.g. `http://localhost:3001`). JSON in,
JSON out (`Content-Type: application/json`).

**Authentication.** A server-side session (`@fastify/session`, stored in
Postgres table `user_sessions`) identified by the signed, `HttpOnly`,
`SameSite=Lax` cookie **`sessionId`** (7-day max age, `Secure` in
production). Register and login set it; logout destroys it. "Auth: session"
below means the route runs `requireAuth` and answers `401 UNAUTHENTICATED`
without a valid session. CORS allows only `CLIENT_ORIGIN`, with credentials.

**Timestamps** are ISO-8601 strings in UTC (`2026-01-01T00:00:00.000Z`).
**IDs** are UUIDs.

### Error envelope

Every non-2xx response, and every failed socket ack, has the same body
(`apiErrorSchema`):

```json
{ "code": "CONVERSATION_NOT_FOUND", "message": "Conversation not found" }
```

```json
{
  "code": "VALIDATION_FAILED",
  "message": "Validation failed",
  "issues": [{ "path": ["memberId"], "message": "Invalid UUID" }]
}
```

| Field     | Type                                         | Notes                                                           |
| --------- | -------------------------------------------- | --------------------------------------------------------------- |
| `code`    | `ErrorCode`                                  | Machine-readable, stable. **Clients branch on this only.**      |
| `message` | string                                       | Human-readable, may change. Never shown as the only signal.     |
| `issues`  | `{ path: (string \| number)[], message }[]`  | Only for `VALIDATION_FAILED`.                                   |

The code → status mapping is fixed in one place
(`packages/api/src/http/errors.ts`, `STATUS_BY_CODE`):

| Code                     | Status | Meaning                                                                |
| ------------------------ | ------ | ---------------------------------------------------------------------- |
| `VALIDATION_FAILED`      | 400    | Body, query or params failed the zod schema.                           |
| `BAD_REQUEST`            | 400    | Request could not be parsed (e.g. malformed JSON).                     |
| `INVALID_CURSOR`         | 400    | Cursor is malformed, from another list, or from another conversation.  |
| `INVALID_MEMBER`         | 400    | Tried to start a conversation with yourself.                           |
| `UNAUTHENTICATED`        | 401    | No session, expired session, or the session's user no longer exists.   |
| `INVALID_CREDENTIALS`    | 401    | Wrong username or password (deliberately not distinguished).           |
| `USER_NOT_FOUND`         | 404    | Referenced user does not exist.                                        |
| `CONVERSATION_NOT_FOUND` | 404    | Conversation does not exist **or caller is not a member**.             |
| `MESSAGE_NOT_FOUND`      | 404    | Message does not exist in that conversation.                           |
| `ROUTE_NOT_FOUND`        | 404    | No such route.                                                         |
| `USERNAME_TAKEN`         | 409    | Username already registered.                                           |
| `IDEMPOTENCY_CONFLICT`   | 409    | `clientMessageId` reused with a different payload.                     |
| `PAYLOAD_TOO_LARGE`      | 413    | Body over Fastify's limit (1 MiB).                                     |
| `UNSUPPORTED_MEDIA_TYPE` | 415    | Body with a content type the server has no parser for.                 |
| `INTERNAL`               | 500    | Anything unexpected. Details are logged server-side, never returned.  |

Any route can also return `500 INTERNAL`; it is not repeated per route below.

### Non-members get 404, not 403

A conversation the caller is not a member of is answered exactly like one that
does not exist: **`404 CONVERSATION_NOT_FOUND`**. A 403 would confirm that the
UUID names a real conversation, turning the API into an existence oracle for
other people's conversations. Members never see a 403 either — there is no
action a member is forbidden from — so the API has no 403 at all. The same
rule applies on the socket (`conversation:join`, `typing:*`, `message:read`,
`message:send`).

## HTTP routes

Summary:

| Method | Path                       | Auth    | Success       | Errors                    |
| ------ | -------------------------- | ------- | ------------- | ------------------------- |
| GET    | `/health`                  | none    | 200           | —                         |
| POST   | `/auth/register`           | none    | 201           | 400, 409                  |
| POST   | `/auth/login`              | none    | 200           | 400, 401                  |
| POST   | `/auth/logout`             | session | 200           | 401                       |
| GET    | `/auth/me`                 | session | 200           | 401                       |
| GET    | `/users`                   | session | 200           | 400, 401                  |
| GET    | `/users/:id/public-key`    | session | 200           | 400, 401, 404             |
| POST   | `/chat/conversations`      | session | 201 / 200     | 400, 401, 404             |
| GET    | `/chat/conversations`      | session | 200           | 401                       |
| GET    | `/chat/messages`           | session | 200           | 400, 401, 404             |

### `GET /health`

Liveness probe. **Auth:** none. **Response 200:** `{ "status": "ok" }`.
**Idempotent:** yes (safe).

### `POST /auth/register`

Create an account with its E2EE key material and start a session.

- **Auth:** none.
- **Request** (`registerUserSchema`):

  | Field               | Type                                   | Rules                         |
  | ------------------- | -------------------------------------- | ----------------------------- |
  | `username`          | string                                 | 3–32 chars, `[A-Za-z0-9_-]`   |
  | `password`          | string                                 | 8–128 chars                   |
  | `publicKey`         | string                                 | non-empty (base64)            |
  | `wrappedPrivateKey` | `{ ciphertext, salt, nonce }` strings  | all non-empty                 |

- **Response 201:** `{ id, username, createdAt }`. Sets `sessionId`.
  Broadcasts `user:new` to every connected socket.
- **Errors:** `400 VALIDATION_FAILED`; `409 USERNAME_TAKEN` (also under a
  concurrent race: the `UNIQUE(username)` constraint decides the winner).
- **Idempotent:** no. Repeating it returns `409 USERNAME_TAKEN`.

### `POST /auth/login`

- **Auth:** none.
- **Request** (`loginUserSchema`): `{ username: string, password: string }`,
  both non-empty.
- **Response 200:**
  `{ id, username, createdAt, publicKey, wrappedPrivateKey: { ciphertext, salt, nonce } }`.
  Sets `sessionId`. The private key stays wrapped; the client unwraps it with
  the password.
- **Errors:** `400 VALIDATION_FAILED`; `401 INVALID_CREDENTIALS` for an
  unknown user *or* a wrong password (same response, and a dummy bcrypt
  compare keeps timing similar).
- **Idempotent:** yes in effect — repeating it re-authenticates the same
  session.

### `POST /auth/logout`

- **Auth:** session.
- **Request:** no body.
- **Response 200:** `{ "ok": true }`. Destroys the session row.
- **Errors:** `401 UNAUTHENTICATED`.
- **Idempotent:** the effect is (you end up logged out), the response is not:
  a second call has no session and gets `401`. Clients treat 401 from logout
  as success.

### `GET /auth/me`

- **Auth:** session.
- **Response 200:** `{ id, username, createdAt }`.
- **Errors:** `401 UNAUTHENTICATED` — including when the session is valid but
  its user was deleted; that session is destroyed on the spot.
- **Idempotent:** yes (safe).

### `GET /users`

The contact directory: every user except the caller. Cursor-paginated.

- **Auth:** session.
- **Query** (`listUsersQuerySchema`): `limit` integer 1–100, default 50;
  `cursor` opaque string from a previous `nextCursor`.
- **Response 200** (`usersPageSchema`):
  `{ items: { id, username }[], nextCursor: string | null }`, ordered by
  `id ASC`.
- **Errors:** `400 VALIDATION_FAILED` (bad `limit`); `400 INVALID_CURSOR`;
  `401 UNAUTHENTICATED`.
- **Idempotent:** yes (safe).

### `GET /users/:id/public-key`

- **Auth:** session.
- **Params:** `id` UUID.
- **Response 200:** `{ publicKey: string }`.
- **Errors:** `400 VALIDATION_FAILED` (not a UUID); `401 UNAUTHENTICATED`;
  `404 USER_NOT_FOUND`.
- **Idempotent:** yes (safe).

### `POST /chat/conversations`

Get-or-create the direct conversation between the caller and `memberId`.

- **Auth:** session.
- **Request** (`createConversationSchema`): `{ memberId: uuid }`.
- **Response** (`conversationSchema`): `{ id, createdAt }`.
  - **201 Created** — this call created the conversation.
  - **200 OK** — it already existed (created earlier, by either member);
    the existing one is returned.
- **Errors:** `400 VALIDATION_FAILED`; `400 INVALID_MEMBER` (`memberId` is the
  caller); `401 UNAUTHENTICATED`; `404 USER_NOT_FOUND` (no such user).
- **Idempotent:** yes. Any number of calls, from either side, concurrently or
  not, yield one conversation: `conversations.direct_key` (`dm:<lowId>:<highId>`)
  is UNIQUE and the insert is `ON CONFLICT DO NOTHING`. Exactly one concurrent
  caller gets 201.
- **Side effects:** none on the socket. The caller should emit
  `conversation:join` with the returned id; the other member's sockets are
  joined when the first message arrives (`conversation:updated`).

### `GET /chat/conversations`

- **Auth:** session.
- **Response 200:** array of the caller's conversations, unpaginated:

  ```ts
  {
    id: string; directKey: string | null; createdAt: string;
    members: { id: string; conversationId: string; userId: string;
               user: { id: string; username: string } }[];
  }[]
  ```

- **Errors:** `401 UNAUTHENTICATED`.
- **Idempotent:** yes (safe). Unpaginated and unordered — see
  [Known gaps](#known-gaps).

### `GET /chat/messages`

A page of a conversation's history, newest page first.

- **Auth:** session.
- **Query** (`listMessagesQuerySchema`): `conversationId` UUID (required);
  `limit` integer 1–100, default 50; `cursor` opaque string from a previous
  `nextCursor`.
- **Response 200** (`messagesPageSchema`):

  ```ts
  {
    items: {
      id: string; clientMessageId: string; conversationId: string;
      senderId: string; ciphertext: string; nonce: string; algorithm: string;
      createdAt: string; sender: { id: string; username: string };
    }[];                       // oldest → newest within the page
    nextCursor: string | null; // older messages exist iff non-null
  }
  ```

- **Errors:** `400 VALIDATION_FAILED`; `400 INVALID_CURSOR` (malformed, a
  users cursor, or a message from another conversation);
  `401 UNAUTHENTICATED`; `404 CONVERSATION_NOT_FOUND` (does not exist or not a
  member).
- **Idempotent:** yes (safe).

## Socket.IO

Same origin as the HTTP API, `withCredentials: true`. Event names and payload
types are `ServerToClientEvents` / `ClientToServerEvents` in
`packages/shared/src/contracts/socket.ts`; every client payload is parsed with
its zod schema on the server.

### Connection

- **Auth:** the `sessionId` cookie on the handshake, resolved against the same
  session store as HTTP.
- **Rejection:** `connect_error` with `err.message === "UNAUTHENTICATED"` and
  `err.data = { code: "UNAUTHENTICATED", message }`. No retry will succeed
  until the user logs in again.
- **On connect** the server joins the socket to `user:<userId>` and to
  `conv:<id>` for every conversation the user is a member of, then emits
  `presence:update { online: true }` to those conversations.
- **On disconnect** it emits `presence:update { online: false }`.

Being in a `conv:<id>` room is the authorisation for that conversation's
realtime traffic: rooms are only ever joined after a membership check.

### Errors on the socket

- Events with an ack (`message:send`) fail through the ack:
  `{ ok: false, error: <error envelope> }`.
- Fire-and-forget events (`typing:*`, `message:read`, `conversation:*`) that
  are rejected cause an **`error`** event to the sender only:
  `{ event: "<client event name>", error: <error envelope> }`. Nothing is
  broadcast.

### Client → server

#### `message:send` (with ack)

- **Payload** (`sendMessageSchema`):

  | Field             | Type   | Rules                                                         |
  | ----------------- | ------ | ------------------------------------------------------------- |
  | `clientMessageId` | uuid   | Idempotency key — see [Idempotency](#idempotency)             |
  | `conversationId`  | uuid   | Caller must be a member                                       |
  | `ciphertext`      | string | 1–65 536 chars (base64)                                       |
  | `nonce`           | string | 1–256 chars                                                   |
  | `algorithm`       | string | 1–64 chars                                                    |

- **Ack** (`sendMessageAckSchema`):
  - `{ ok: true, message: Message, replayed: boolean }` — `replayed` is
    `true` when the key was already stored and this is a retry.
  - `{ ok: false, error }` with `error.code` one of `VALIDATION_FAILED`,
    `CONVERSATION_NOT_FOUND`, `IDEMPOTENCY_CONFLICT`, `INTERNAL`.
- **Effects on first delivery (`replayed: false`):** `message:new` to
  `conv:<id>`; `conversation:updated` to each other member's `user:<id>` room
  (whose sockets are also joined to `conv:<id>`); `message:ack` to the
  sender.
- **Effects on replay (`replayed: true`):** `message:ack` to the sender only.
  Nothing is re-broadcast — the other members already received it.
- A missing ack callback is tolerated (the message is still processed).

#### `conversation:join`

- **Payload** (`conversationRefSchema`): `{ conversationId: uuid }`.
- **Effect:** the socket joins `conv:<id>` after a DB membership check.
- **Errors (`error` event):** `VALIDATION_FAILED`, `CONVERSATION_NOT_FOUND`.
- **Idempotent:** yes; joining a room twice is a no-op.

#### `conversation:leave`

- **Payload:** `{ conversationId: uuid }`.
- **Effect:** the socket leaves `conv:<id>` (stops receiving `message:new`,
  typing and presence for it; `conversation:updated` still arrives via the
  user room).
- **Errors:** `VALIDATION_FAILED`. **Idempotent:** yes.

#### `typing:start` / `typing:stop`

- **Payload:** `{ conversationId: uuid }`.
- **Effect:** `typing:indicator { conversationId, userId, isTyping }` to the
  rest of `conv:<id>` (not the sender).
- **Errors:** `VALIDATION_FAILED`; `CONVERSATION_NOT_FOUND` when the socket is
  not in that conversation's room.
- **Idempotent:** yes (state, not a counter). Not persisted.

#### `message:read`

- **Payload** (`messageReadSchema`): `{ messageId: uuid, conversationId: uuid }`.
- **Effect:** inserts a `message_reads` row. No event is emitted yet.
- **Errors:** `VALIDATION_FAILED`; `CONVERSATION_NOT_FOUND` (not a member);
  `MESSAGE_NOT_FOUND` (message not in that conversation).
- **Idempotent:** yes — `UNIQUE(message_id, user_id)`, `ON CONFLICT DO NOTHING`;
  the first read time is kept.

### Server → client

| Event                  | Payload                                              | Sent to                                     |
| ---------------------- | ---------------------------------------------------- | ------------------------------------------- |
| `message:new`          | `Message`                                            | `conv:<id>` (includes the sender's sockets) |
| `message:ack`          | `{ clientMessageId, message: Message }`              | the sending socket                          |
| `conversation:updated` | `{ conversationId, message: Message }`               | each other member's `user:<id>`             |
| `user:new`             | `{ id, username }`                                   | every socket (after `POST /auth/register`)  |
| `typing:indicator`     | `{ conversationId, userId, isTyping }`               | `conv:<id>` except the typist               |
| `presence:update`      | `{ userId, online }`                                 | every `conv:<id>` of that user              |
| `error`                | `{ event, error: { code, message, issues? } }`       | the offending socket                        |

`Message` is `messageSchema` — the same shape as an item of
`GET /chat/messages`. A client can receive the same message more than once
(`message:new` and `conversation:updated`, a reconnect, a replay ack), so
**clients dedupe by `id`** and reconcile optimistic rows by `clientMessageId`.

## Pagination

`GET /users` and `GET /chat/messages` use keyset (cursor) pagination with one
response shape, `pageSchema(item)`:

```json
{ "items": [ ... ], "nextCursor": "eyJ2IjoxLCJrIjoibWVzc2FnZXMiLCJpZCI6Ii4uLiJ9" }
```

- **Requesting:** omit `cursor` for the first page; pass the previous
  response's `nextCursor` verbatim for the next. `limit` is 1–100 (default 50).
- **End of list:** `nextCursor: null`. A page may hold fewer than `limit`
  items only when it is the last one. The server fetches `limit + 1` rows to
  know, so there is never an empty trailing page.
- **Cursor contents:** opaque to clients. Today it is
  `base64url(JSON {"v":1,"k":"<list>","id":"<uuid>"})` — a version, the list
  it belongs to (`users` | `messages`), and the id of the last row returned.
  Clients must not build or parse it; the format may change behind `v`.
- **Invalid cursors** — not base64/JSON, wrong version, minted for another
  list, or (messages) naming a message outside this conversation — get
  `400 INVALID_CURSOR`, never a silently restarted list.
- **Stability:** the sort key is unique, so the order is total. Rows inserted
  while paging never cause duplicates or skips among the rows that existed.
  The cursor stores only an id; the server resolves its sort key inside
  Postgres, so no timestamp precision is lost in a round trip.

| List             | Order                                         | Cursor = id of     | Index                                                       |
| ---------------- | --------------------------------------------- | ------------------ | ----------------------------------------------------------- |
| `/users`         | `id ASC`                                      | last item          | `users_pkey`                                                |
| `/chat/messages` | `created_at DESC, id DESC` (newest first)     | oldest item        | `messages_conversation_created_id_idx (conversation_id, created_at, id)` |

Messages: page *N+1* holds the messages strictly older than page *N* under
the row comparison `(created_at, id) < (cursor.created_at, cursor.id)`. Within
a page, `items` are returned **oldest → newest** so the UI can render them
directly; "next" means "older". New messages arrive over the socket, not by
re-paging.

> **Fixed in this change.** History used `?before=<messageId>` with
> `created_at < cursor.created_at`, ordered by `created_at` alone. Messages
> sharing a timestamp were skipped at page boundaries, the order among them
> was undefined, and an unknown `before` id silently returned the newest page.
> `/users` returned a bare array (no cursor at all).

## Idempotency

| Operation                      | Key                                     | Mechanism                                       |
| ------------------------------ | --------------------------------------- | ----------------------------------------------- |
| `message:send`                 | `(senderId, clientMessageId)`           | `UNIQUE(sender_id, client_message_id)`          |
| `POST /chat/conversations`     | the unordered member pair               | `UNIQUE(direct_key)`                            |
| `message:read`                 | `(messageId, userId)`                   | `UNIQUE(message_id, user_id)`                   |
| `POST /auth/register`          | `username`                              | `UNIQUE(username)` → 409 on repeat              |
| `GET` routes, typing, join/leave | —                                     | naturally idempotent                            |

### Replayed `clientMessageId`

The client generates `clientMessageId` (UUID v4) **once per logical message**
and resends the identical payload on every retry (ack timeout, disconnect,
user-initiated retry).

| Replay                                                                  | Result                                                                                        |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Same sender, same key, same `conversationId`/`ciphertext`/`nonce`/`algorithm` | `{ ok: true, message: <the originally stored message>, replayed: true }` — same `id`, same `createdAt`. No new row, no re-broadcast. |
| Same sender, same key, **any field different**                          | `{ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } }`. Nothing stored.                    |
| Different sender, same key                                              | Independent — keys are scoped per sender.                                                    |
| Sender is no longer a member                                            | `CONVERSATION_NOT_FOUND` (membership is checked before the key lookup).                      |

**Key validity:** forever. Keys are stored on the message row and never
expire, so a retry after any delay is safe; a key is "spent" only if the
message row is deleted (its conversation or sender is deleted — cascades).
Do not reuse a key for a new message, even after a conflict.

## Data model

Postgres, managed by drizzle (`packages/api/src/db/schema`, migrations in
`packages/api/drizzle`). All ids are `uuid DEFAULT gen_random_uuid()`. All
foreign keys are `ON DELETE CASCADE`.

### `users`

| Column          | Type      | Constraints              |
| --------------- | --------- | ------------------------ |
| `id`            | uuid      | **PK**                   |
| `username`      | text      | NOT NULL, **UNIQUE**     |
| `password_hash` | text      | NOT NULL (bcrypt, 12)    |
| `created_at`    | timestamp | NOT NULL DEFAULT now()   |

### `user_keys`

| Column                | Type      | Constraints                                    |
| --------------------- | --------- | ---------------------------------------------- |
| `id`                  | uuid      | **PK**                                         |
| `user_id`             | uuid      | NOT NULL, **UNIQUE**, **FK → users.id**        |
| `public_key`          | text      | NOT NULL                                       |
| `wrapped_private_key` | text      | NOT NULL (JSON `{ ciphertext, salt, nonce }`)  |
| `created_at`          | timestamp | NOT NULL DEFAULT now()                         |

### `conversations`

| Column       | Type      | Constraints                                                  |
| ------------ | --------- | ------------------------------------------------------------ |
| `id`         | uuid      | **PK**                                                       |
| `direct_key` | text      | **UNIQUE**, nullable; `dm:<lowId>:<highId>` for DMs          |
| `created_at` | timestamp | NOT NULL DEFAULT now()                                       |

### `conversation_members`

| Column            | Type | Constraints                       |
| ----------------- | ---- | --------------------------------- |
| `id`              | uuid | **PK**                            |
| `conversation_id` | uuid | NOT NULL, **FK → conversations.id** |
| `user_id`         | uuid | NOT NULL, **FK → users.id**       |

- **UNIQUE(conversation_id, user_id)** *(added in 0002)* — also serves
  membership checks and "members of a conversation".
- **INDEX(user_id)** *(added in 0002)* — "my conversations", run on every
  socket connect and `GET /chat/conversations`.
- **Why a surrogate `id` plus UNIQUE pair, not a composite PK:** the pair is
  the real identity and the UNIQUE constraint enforces it just as a PK would.
  The surrogate is kept because it is already exposed (`members[].id` in
  `GET /chat/conversations`), it gives a stable single-column handle if
  membership grows its own attributes or child rows (role, muted, last-read
  pointer), and dropping it would be a breaking migration for no integrity
  gain. The cost is one extra index and column; a greenfield table would use
  `PRIMARY KEY (conversation_id, user_id)`.

### `messages`

| Column              | Type      | Constraints                         |
| ------------------- | --------- | ----------------------------------- |
| `id`                | uuid      | **PK**                              |
| `client_message_id` | uuid      | NOT NULL                            |
| `conversation_id`   | uuid      | NOT NULL, **FK → conversations.id** |
| `sender_id`         | uuid      | NOT NULL, **FK → users.id**         |
| `ciphertext`        | text      | NOT NULL                            |
| `nonce`             | text      | NOT NULL                            |
| `algorithm`         | text      | NOT NULL                            |
| `created_at`        | timestamp | NOT NULL DEFAULT now()              |

- **UNIQUE(sender_id, client_message_id)** — the idempotency key.
- **INDEX(conversation_id, created_at, id)** *(added in 0002)* — history
  keyset.

### `message_reads`

| Column       | Type      | Constraints                    |
| ------------ | --------- | ------------------------------ |
| `id`         | uuid      | **PK**                         |
| `message_id` | uuid      | NOT NULL, **FK → messages.id** |
| `user_id`    | uuid      | NOT NULL, **FK → users.id**    |
| `read_at`    | timestamp | NOT NULL DEFAULT now()         |

- **UNIQUE(message_id, user_id)**.

### `user_sessions`

Created at runtime by `connect-pg-simple` (`createTableIfMissing`), not by a
migration: `sid` varchar **PK**, `sess` json NOT NULL, `expire` timestamp(6)
NOT NULL, index on `expire`.

## Known gaps

### Fixed in this change

| Gap                                                                                           | Fix                                                                                       |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Each module had its own error shape (`{ error: "..." }`, bare strings in acks).                | One envelope + `code`, one root error handler, `toApiError` shared by HTTP and socket.    |
| Non-member got `403`, nonexistent conversation reached the DB unchecked.                      | `404 CONVERSATION_NOT_FOUND` for both.                                                    |
| `POST /chat/conversations` always returned 201; allowed yourself; unknown user hit an FK 500.  | 201 / 200; `400 INVALID_MEMBER`; `404 USER_NOT_FOUND`.                                    |
| History order unstable on equal `created_at`; ties skipped across pages; unknown cursor ignored. | `(created_at, id)` keyset resolved in SQL, `INVALID_CURSOR`, `nextCursor`.                 |
| `/users` unpaginated bare array.                                                              | `{ items, nextCursor }`, `id ASC` keyset.                                                 |
| Replayed `clientMessageId` re-broadcast `message:new` to every member.                        | Replays ack the sender only, `replayed: true`.                                            |
| `conversation_members` had no UNIQUE — duplicate rows possible.                               | Migration 0002 dedupes and adds UNIQUE + `user_id` index.                                 |
| No index for history.                                                                         | `messages(conversation_id, created_at, id)`.                                              |
| `conversation:join` joined any room; `typing:*` broadcast to any room; `message:read` accepted any id. Payloads unvalidated. | Membership checks, zod validation, `error` event.                                         |
| Concurrent registration of one username → 500.                                                | Unique violation → `409 USERNAME_TAKEN`.                                                  |
| `/auth/me` for a deleted user → 404 with a live session.                                      | `401`, session destroyed.                                                                 |
| `SendMessagePayload` / socket event types duplicated in api and web.                          | `packages/shared/src/contracts`, zod + `z.infer`.                                         |
| No length limits on ciphertext / nonce / algorithm.                                           | 65 536 / 256 / 64.                                                                        |

### Scheduled (not fixed here)

| Gap                                                                                                     | Impact                                                                              | Proposed fix                                                                     |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `timestamp` columns are `without time zone`.                                                            | Correct only while the DB session TZ is UTC.                                        | Migrate to `timestamptz`.                                                        |
| Usernames are case-sensitive (`Alice` ≠ `alice`).                                                       | Impersonation-looking duplicates.                                                   | `citext` or a `lower(username)` unique index, after checking existing data.      |
| Group conversations: `direct_key` is NULL, so nothing prevents duplicate groups; the API only creates DMs. | None today.                                                                         | Decide group semantics before exposing them.                                     |
| `GET /chat/conversations` is unpaginated, unordered, and exposes `directKey` and member row ids.        | Grows with the user; leaks internals.                                               | Page by last activity; slim DTO in `contracts`.                                  |
| Web renders only the first page of `/users` (100) and of history (50); no "load older".                 | Users beyond #100 never appear in the sidebar; older messages are unreachable.      | `useInfiniteQuery` on `nextCursor`. **Due by end of Week 3.**                    |
| `User`, `Conversation`, `ConversationMember` in `shared/src/types` are still hand-written interfaces.   | They can drift from what the API returns, unchecked.                                | Replace with `z.infer` of contract schemas (next after the message contract).    |
| `message:read` stores receipts but nothing emits them.                                                  | Read receipts are write-only.                                                       | Emit `message:read` to `conv:<id>`; add `GET` for receipts.                      |
| Login does not regenerate the session id.                                                               | Session fixation if an attacker can plant a cookie.                                 | `req.session.regenerate()` on login/register.                                    |
| Expired `user_sessions` rows rely on `connect-pg-simple`'s pruning; table is not in migrations.          | Schema drift between environments.                                                 | Add the table to a migration; disable `createTableIfMissing`.                    |
| No rate limiting on `/auth/*` or `message:send`.                                                        | Brute force / spam.                                                                 | `@fastify/rate-limit` + per-socket token bucket.                                 |
| Presence is per socket: closing one of two tabs broadcasts `online: false`.                              | Wrong presence.                                                                     | Count sockets in `user:<id>` before emitting offline.                            |
