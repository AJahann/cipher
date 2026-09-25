# Day 10 — `/chat` waterfall

## Verdict

The expensive waterfall was not inside `messages` or decryption. Those requests were already parallel after the selected conversation existed. The accidental dependency was:

```text
/auth/me → SessionGate unlock → mount ChatLayout → /users
```

`/users` is authenticated data, but it does not require the in-memory private key. The route also refetched `/auth/me` when `ChatLayout` mounted because the query was immediately stale.

The change keeps `AuthGuard` as the protected-data boundary, moves `SessionGate` around only the conversation pane, and gives the established `useMe` result a 30-second reuse window. Contacts can now load while the user unlocks the session, without rendering protected chat content before authentication or decryption is ready.

## Measurement method

- Production Next build of the web app.
- Three fresh browser contexts, each with the same authenticated storage state and a cold `/chat` navigation.
- Cache was not reused between contexts.
- A browser `fetch` wrapper recorded client request start/end times.
- Milestones were recorded at first DOM visibility:
  - unlock form usable;
  - sidebar visible;
  - chat input usable after selecting a contact.
- The API was a local fixture implementing the real client endpoints. Therefore these numbers measure the client/route waterfall and browser work, not production database latency.
- Timings below are milliseconds from the document's performance timeline. Medians are used for comparison.

## Before — measured waterfall (median of 3 runs)

```text
navigation start
  └─ HTML/RSC response: responseStart 12.0; responseEnd 19.7
      └─ JS + hydration: not separately marked; DOMContentLoaded 153.3; load 242.7
          └─ /auth/me #1: starts 316.0
              └─ session/localStorage check → unlock form: 337.7
                  └─ unlock/restore private key
                      └─ /auth/me #2: starts 600.3
                      └─ /users: starts 601.7
                          └─ sidebar visible: 621.8
                              └─ POST /chat/conversations: starts 667.4
                                  ├─ GET /chat/messages: starts 683.8
                                  └─ GET /users/user-2/public-key: starts 684.7
                                      └─ chat input usable: 692.9
```

The second `/auth/me` and `/users` were coupled to mounting `ChatLayout` after unlock. The second auth request was unnecessary; the first request had already established the identity.

## After — measured waterfall (median of 3 runs)

```text
navigation start
  └─ HTML/RSC response: responseStart 11.3; responseEnd 14.8
      └─ JS + hydration: not separately marked; DOMContentLoaded 205.0; load 214.0
          └─ /auth/me: starts 336.5
              ├─ localStorage/session-key check: unlock form usable 368.9
              └─ /users: starts 362.5
                  └─ sidebar visible: 384.6
                      └─ after unlock + contact selection:
                          └─ POST /chat/conversations: starts 679.0
                              ├─ GET /chat/messages: starts 693.7
                              └─ GET /users/user-2/public-key: starts 694.6
                                  └─ chat input usable: 704.3
```

The contacts request now starts after authentication but independently of the unlock path. Messages and the receiver public-key request remain parallel and still depend on the selected conversation/receiver.

## Dependency classification

| Work | Dependency | Classification | Evidence / decision |
|---|---|---|---|
| HTML/RSC response | navigation | necessary | Route is a static App Router shell. |
| JavaScript + hydration | HTML/RSC | necessary | Client components and providers must hydrate before hooks run. |
| `/auth/me` | browser navigation + API session | necessary | `AuthGuard` must establish identity before protected data is trusted. |
| `localStorage` wrapped-key check | browser runtime | independent of `/auth/me` execution, but must not unlock protected content by itself | Now runs in the chat pane while `AuthGuard` remains outside. |
| In-memory private-key check / unlock | browser-only crypto state | necessary before decryption | Remains in `SessionGate`; no key or Web Crypto work moved server-side. |
| `/users` contacts | authenticated client | independent of unlock | Now starts while unlock is available. |
| `POST /chat/conversations` | selected contact | necessary | Conversation id is created/returned by this request. |
| `/chat/messages` | selected conversation id | necessary | `enabled: !!conversationId`; not parallelized with conversation creation. |
| receiver public key | selected receiver id | independent of messages after selection | Observed starting within 1 ms of `/chat/messages`. |
| message decryption | ciphertext + receiver key + in-memory private key | necessary | Remains client-side and guarded by the key boundary. |

## Before/after result

| Milestone | Before runs | After runs | Median change |
|---|---:|---:|---:|
| Unlock form usable | 367.0 / 321.9 / 337.7 | 346.2 / 373.1 / 368.9 | +31.2 ms (+9.2%); noisy, not an improvement claim |
| Sidebar visible | 664.5 / 621.8 / 619.9 | 368.6 / 386.4 / 384.6 | **−237.2 ms (−38.1%)** |
| Chat input usable | 748.1 / 692.9 / 679.9 | 674.2 / 715.4 / 704.3 | +11.4 ms (+1.6%); effectively unchanged |
| `/users` request start | 649.0 / 601.7 / 600.0 | 336.8 / 362.8 / 362.5 | **−239.2 ms (−39.8%)** |
| `/chat/messages` request start | 738.3 / 683.8 / 670.7 | 663.0 / 705.8 / 693.7 | +9.9 ms (+1.4%); unchanged after the selected conversation |

The measured improvement is specifically **sidebar/contact availability**, not end-to-end first-message time. The latter still includes the user's unlock and contact-selection steps and was statistically unchanged across these three local runs.

## Why this intervention

- **Chosen:** move the unlock boundary down to the conversation pane and reuse the already-established auth query.
- **Not `loading.tsx`:** the route shell is static and the delay is client-side auth/session/data orchestration; route-level loading would not start `/users` earlier.
- **Not Suspense:** the blocked work is client hooks, `localStorage`, in-memory key state, and Web Crypto. A decorative boundary would not parallelize these requests.
- **Not `Promise.all`:** `/chat/messages` cannot start before a conversation id exists. The independent public-key request is already parallel with messages.
- **Not preload:** contacts are needed immediately after auth and now start at the correct boundary; speculative preloading would not address the unlock gate.

## Verification

- `NEXT_PUBLIC_API_URL=http://127.0.0.1:4100 pnpm test:unit:web` — 5 files, 16 tests passed.
- `NEXT_PUBLIC_API_URL=http://127.0.0.1:4100 pnpm --filter web build` — passed.
- `pnpm --filter web lint` still reports one pre-existing error in `use-chat-socket.ts:95` (`setConnected(true)` inside an effect); the Day 10 change does not touch that file.
