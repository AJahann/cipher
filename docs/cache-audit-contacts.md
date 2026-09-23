# Contacts cache audit

Scope: the contacts/user-directory feature in `apps/web`, reviewed on the
`day-9-cache-audit` branch.

## Feature trace

```text
/chat/layout.tsx (Server Component wrapper)
  -> AuthGuard (Client Component)
  -> SessionGate (Client Component)
  -> ChatLayout (Client Component)
  -> useUsersList()
  -> apiFetch('/users')
  -> GET /users
  -> Sidebar(users)
```

Relevant implementation:

- Route boundary: `apps/web/src/app/chat/layout.tsx`
- Client feature entry: `apps/web/src/components/chat-layout.tsx`
- Query hook and keys: `apps/web/src/lib/data-layer/user/use-user.ts`
- Fetch wrapper: `apps/web/src/lib/data-layer/client.ts`
- Realtime synchronization: `apps/web/src/lib/data-layer/chats/use-chat-socket.ts`
- Server broadcast: `packages/api/src/modules/auth/auth.controller.ts`

`useUsersList()` uses `apiFetch('/users')`, which runs in the browser. The
request is not a Server Component fetch and does not enter the Next.js Data
Cache.

## Cache ownership map

| Layer | Present in this feature? | Scope | Key | Freshness | Invalidator | Stale-data risk |
| --- | --- | --- | --- | --- | --- | --- |
| Request Memoization | No — not involved | None | None | None | None | None |
| Next.js Data Cache | No — the contacts fetch runs in a Client Component | None | None | None | None | None |
| Full Route Cache | No for contacts data | The route shell may be cached independently; contacts are not in the shell data | None | None | None | Contacts are not owned by this layer |
| Router Cache | No for contacts data | Browser RSC/navigation shell only | None | None | None | Contacts changes do not come from Router Cache |
| TanStack Query | Yes | Browser tab; shared `QueryClient` | `userKeys.list(limit, after)` | TanStack Query defaults; no explicit `staleTime` or `gcTime` | Register/login invalidation, `user:new`, and `conversation:updated` | A missed invalidation/refetch can leave the list stale |
| Socket.IO state | Yes, but not a data cache | Browser singleton and API process rooms | `user:<id>` and `conv:<id>` | Connection/process lifetime | Socket events and reconnect | Missed events are not replayed |

### Adjacent state, not cache owners

- `localStorage` stores the wrapped private key and the local public key. It
  does not store contacts.
- PostgreSQL is the backend source of truth for users.
- The PostgreSQL session store is authentication persistence, not a contacts
  cache.

## Query configuration

`QueryProvider` creates one module-level `QueryClient`. It does not configure
`staleTime`, `gcTime`, retry behavior, refetch-on-focus, or network mode.
Contacts therefore use the installed TanStack Query defaults.

`useUsersList()` also does not override query options. `useMe()` is different:
it explicitly sets `retry: false`, but that applies to current-user state, not
the contacts query.

## Invalidation path: registering a user

```text
Register form
  -> POST /auth/register
  -> userService.register()
  -> PostgreSQL insert
  -> app.io.emit('user:new')
  -> useChatRealtimeSync()
  -> invalidate userKeys.listRoot()
  -> active useUsersList() refetches
  -> Sidebar renders the new user
```

### Cache effects

- The contacts query prefix `userKeys.listRoot()` is invalidated.
- The current-user query is not invalidated for other clients.
- `localStorage` is not changed.
- Next.js Data Cache, Full Route Cache, and Router Cache are not involved.
- The Socket.IO room only delivers the event; it does not retain the user
  directory.

### Full reload

After a full page reload, the in-memory Query cache is gone. `useUsersList()`
runs `GET /users` again and rebuilds the list from PostgreSQL. The local crypto
storage does not affect this flow.

### Missed socket event

Before this change, a client that missed `user:new` could retain an old
contacts list until a later refetch or a full reload. Socket reconnect restored
room membership but did not reconcile the contacts query.

## Minimal fix

`useChatRealtimeSync()` now listens to the Socket.IO `connect` event and
invalidates only `userKeys.listRoot()`. This reconciles a contacts list after a
missed event without refreshing messages, public keys, auth state, or every
TanStack Query entry.

No `router.refresh()`, `revalidate = 0`, global invalidation, Next.js cache
configuration, or new cache layer was added.

## Verification

Focused regression coverage lives in:

```text
apps/web/src/lib/data-layer/chats/use-chat-socket.test.tsx
```

The test verifies that a socket `connect` invalidates the contacts prefix and
that the listener is removed on unmount.

Recommended checks:

```bash
pnpm test:unit:web
pnpm --filter web build
pnpm test:e2e --project=chromium
```