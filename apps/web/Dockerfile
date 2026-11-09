FROM node:24.11.1-bookworm-slim AS deps
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install --global pnpm@12.6.0
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/api/package.json ./packages/api/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/ui-tokens/package.json ./packages/ui-tokens/package.json
COPY packages/ui-web/package.json ./packages/ui-web/package.json
RUN pnpm fetch

FROM deps AS build
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT
ENV NEXT_PUBLIC_SENTRY_ENVIRONMENT=$NEXT_PUBLIC_SENTRY_ENVIRONMENT
ARG NEXT_PUBLIC_SENTRY_RELEASE
ENV NEXT_PUBLIC_SENTRY_RELEASE=$NEXT_PUBLIC_SENTRY_RELEASE
ARG NEXT_PUBLIC_TELEMETRY_TOKEN
ENV NEXT_PUBLIC_TELEMETRY_TOKEN=$NEXT_PUBLIC_TELEMETRY_TOKEN
ENV NEXT_TELEMETRY_DISABLED=1
COPY tsconfig.json ./
COPY packages/shared ./packages/shared
COPY packages/ui-tokens ./packages/ui-tokens
COPY packages/ui-web ./packages/ui-web
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --offline \
  && pnpm --filter web build \
  && cp -R /app/apps/web/.next/static /app/apps/web/.next/standalone/apps/web/.next/static \
  && find /app/apps/web/.next/standalone -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.map" \) -delete

FROM node:24.11.1-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
