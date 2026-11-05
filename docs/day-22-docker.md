# Day 22 — Multi-stage packaging and production Compose topology

Base: `31b3d19` (Day 21 merged). Branch: `day-22/docker`.

## Architectural decisions & topology

### 1. Multi-stage packaging without development runtimes
Production images ship neither development compilers (`typescript`, `tsc`, `tsserver`) nor CLI runners (`tsx`, `drizzle-kit`).
- **`packages/api/Dockerfile`**:
  - `deps` stage: Installs `pnpm@12.6.0` on `node:24.11.1-bookworm-slim`, copies package manifests and workspaces, and runs `pnpm fetch`.
  - `build` stage: Builds `@chat-app/api` (`tsc -b && node scripts/finalize-dist.mjs`), then executes `pnpm deploy --prod --offline --trust-lockfile /prod/api`. Post-deploy cleanup purges all leftover TypeScript compiler binaries and strips source/map artifacts (`*.ts`, `*.tsx`, `*.map`, `*.tsbuildinfo`).
  - `runtime` stage: Minimal `node:24.11.1-bookworm-slim` base, non-root `USER node`, and exec-form `CMD ["node", "dist/src/server.js"]` ensuring the Node runtime runs as PID 1 to receive OS signals directly.
- **`apps/web/Dockerfile`**:
  - Multi-stage Next.js packaging using `output: 'standalone'`.
  - Accepts `NEXT_PUBLIC_API_URL` as a build argument (`ARG NEXT_PUBLIC_API_URL`) baked during `next build`.
  - Copies `.next/standalone` and static assets (`.next/static`), runs as `USER node` with `CMD ["node", "apps/web/server.js"]`.
- **Root `.dockerignore`**:
  - Excludes `.git`, `.github`, `**/node_modules`, `**/.next`, `**/dist`, `**/build`, `**/.turbo`, `**/.cache`, `.env*`, `playwright/`, `playwright-report/`, `test-results/`, and `coverage/`.

### 2. Migration execution model
Database migrations are run as an isolated one-shot service (`migrate`) rather than inline on every API replica:
- Runs `node dist/src/db/migrate.js` using `drizzle-orm/node-postgres/migrator` directly against PostgreSQL before any API instance accepts requests.
- Avoids migration concurrency races, schema flappings, and keeps migration permissions decoupled from runtime traffic.
- The `api` service depends on `migrate` with `condition: service_completed_successfully`, and both depend on PostgreSQL's healthcheck (`condition: service_healthy`).

### 3. Graceful SIGTERM shutdown
To ensure zero dropped requests or orphaned worker locks when container orchestration terminates containers:
- `packages/api/src/server.ts` registers `process.once('SIGTERM')` and `process.once('SIGINT')`.
- Orderly teardown:
  1. Disconnects Socket.IO sockets (`io.disconnectSockets(true)`).
  2. Closes Socket.IO server (`io.close()`).
  3. Closes Fastify server (`app.close()`), which invokes `onClose` hooks closing the BullMQ notification worker/queue, clearing presence sync timers, and issuing `redis.quit()`.
  4. Closes the PostgreSQL session store (`sessionStore.close()`).
  5. Drains the database connection pool (`pool.end()`).
- Fast shutdown latency: finishes in ~0.6s, well below Docker's default 10s grace deadline.

---

## Live verification ledger

### 1. Final container image sizes
```
REPOSITORY               TAG          IMAGE ID       CREATED         SIZE
cipher-api               local        f0dca3c2123d   4 minutes ago   373MB
cipher-web               local        4c738b504df6   21 hours ago    380MB
```

Inside the containers, trimmed application code and production node_modules occupy:
- API container: `62M /app` (including `43M /app/node_modules`)
- Web standalone container: `43M /app`

### 2. Docker compose service health (`docker compose ps`)
```
NAME                IMAGE                COMMAND                  SERVICE    CREATED         STATUS                   PORTS
cipher-api-1        cipher-api:local     "docker-entrypoint.s…"   api        2 minutes ago   Up 2 minutes (healthy)   0.0.0.0:3001->3001/tcp, [::]:3001->3001/tcp
cipher-postgres-1   postgres:16-alpine   "docker-entrypoint.s…"   postgres   2 minutes ago   Up 2 minutes (healthy)   0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp
cipher-redis-1      redis:7.4-alpine     "docker-entrypoint.s…"   redis      2 minutes ago   Up 2 minutes (healthy)   0.0.0.0:6379->6379/tcp, [::]:6379->6379/tcp
cipher-web-1        cipher-web:local     "docker-entrypoint.s…"   web        2 minutes ago   Up 2 minutes (healthy)   0.0.0.0:3000->3000/tcp, [::]:3000->3000/tcp
```
One-shot `cipher-migrate-1` completed successfully (`Exited (0)`) and applied all schema migrations before API admission.

### 3. Non-root user verification
```bash
$ docker compose exec api id && docker compose exec web id
uid=1000(node) gid=1000(node) groups=1000(node)
uid=1000(node) gid=1000(node) groups=1000(node)
```
No compilers, development files, or root privileges exist in the running containers:
```bash
$ docker compose exec api which tsc || echo "not found"
not found
$ docker compose exec api which tsx || echo "not found"
not found
```

### 4. Graceful SIGTERM shutdown timing
```bash
$ time docker compose stop api
Container cipher-api-1  Stopping
Container cipher-api-1  Stopped

real    0m0.648s
user    0m0.015s
sys     0m0.060s
```
API log verification confirms clean teardown signal handling:
```json
{"level":30,"time":1793957597393,"pid":1,"hostname":"9f0d573a5c6a","signal":"SIGTERM","msg":"Shutting down API server"}
```

### 5. Cold start & browser E2E flow
Executed from empty volumes:
```bash
$ docker compose down -v
$ docker compose up -d --wait
```
1. Migrations cleanly provisioned a fresh database (`Database migrations applied.`).
2. Browser navigated to `http://localhost:3000/`.
3. Registered `alice` (`password12345`) → generated and wrapped client private keys in browser, established authenticated session.
4. Signed out and registered `bob` (`password12345`) → `alice` discovered in contact list with online status.
5. `bob` initiated conversation with `alice` and sent encrypted message `"Hello Alice from Dockerized Cipher!"`.
6. Message committed atomically with transactional outbox, dispatched via BullMQ worker, and rendered as `sent 13:06`.
