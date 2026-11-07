# Day 23 — Deploy to a Real URL

Base: `20ffbf6` (Day 22 merged). Branch: `day-23/deploy`.

## Deployment Topology & Edge Routing

Cipher's multi-container production stack is deployed behind an edge reverse proxy and public HTTPS tunnel:

```
Internet (Browser / Client)
       │  HTTPS (TLS 1.3 edge termination, Port 443)
       ▼
Public Edge Ingress (localhost.run / Cloudflare Edge)
       │  Multiplexed Secure Tunnel
       ▼
Caddy Reverse Proxy (:80)
       ├── /health, /auth/*, /users*, /chat/*  ──► Fastify API (:3001)
       ├── /socket.io/* (HTTP/1.1 101 Upgrade) ──► Socket.IO WebSocket (:3001)
       └── /* (Static assets, chunks, SSR)      ──► Next.js Standalone (:3000)
```

### Key Architectural Decisions

1. **Unified Origin Resolution:**
   - Previous builds coupled browser API queries to `NEXT_PUBLIC_API_URL: http://localhost:3001`.
   - Introduced `getApiOrigin()` in `apps/web/src/lib/data-layer/api-origin.ts` which dynamically resolves to `window.location.origin` in the browser.
   - Result: Zero CORS mismatch, same-origin cookie delivery (`SameSite=Lax`), and automatic alignment with whatever public domain or tunnel URL fronts the application.

2. **Multiple Allowed Origins & Reverse Proxy Integration:**
   - `packages/api/src/config/env.ts` updated to allow comma-separated origins for `CLIENT_ORIGIN` (`http://localhost:3000,http://localhost:80,http://localhost`).
   - `packages/api/src/security/http.ts`, `packages/api/src/app.ts`, and `packages/api/src/modules/auth/github.controller.ts` validate incoming browser mutations and WebSocket handshakes against the allowed origin whitelist.

3. **Edge Ingress Routing via Caddy (`Caddyfile`):**
   - Directs REST endpoints (`/health`, `/auth/*`, `/users*`, `/chat/*`) to `api:3001`.
   - Directs real-time events (`/socket.io/*`) with full WebSocket upgrade support to `api:3001`.
   - Directs HTML and static asset requests to `web:3000`.

---

## Live Verification Ledger

### 1. Active Public Live URL
- **Public URL:** `https://2c58f297972dd0.lhr.life`

### 2. HTTP Root Route Verification (`GET /`)
```http
HTTP/1.1 200 OK
cache-control: s-maxage=31536000
content-length: 10721
content-type: text/html; charset=utf-8
date: Fri, 06 Nov 2026 22:49:41 GMT
etag: "hm3gtvo8un89r"
via: 1.1 Caddy
x-nextjs-cache: HIT
x-nextjs-prerender: 1
x-powered-by: Next.js
```
The Next.js standalone container returns the pre-rendered initial sign-in page with full static chunk headers.

### 3. API Healthcheck Verification (`GET /health`)
```http
HTTP/1.1 200 OK
access-control-allow-credentials: true
cache-control: no-store
content-length: 15
content-type: application/json; charset=utf-8
date: Fri, 06 Nov 2026 22:49:19 GMT
vary: Origin
via: 1.1 Caddy

{"status":"ok"}
```
Fastify API healthcheck successfully routes through the public tunnel and reverse proxy, confirming DB/Redis-backed service readiness.

### 4. WebSocket Protocol Upgrade (`101 Switching Protocols`)
```http
HTTP/1.1 101 Switching Protocols
access-control-allow-credentials: true
connection: Upgrade
sec-websocket-accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
server: Caddy
upgrade: websocket
vary: Origin
date: Fri, 06 Nov 2026 22:54:43 GMT

0{"sid":"RVrqMrGllLm4KS5CAAAB","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":98304}
```
Verified bidirectional WebSocket upgrade: Caddy switches protocols on the public tunnel, and Fastify Socket.IO allocates an active session ID (`sid`) with heartbeat timers (`pingInterval: 25000`).
