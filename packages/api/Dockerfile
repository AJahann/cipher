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
COPY tsconfig.json ./
COPY packages/shared ./packages/shared
COPY packages/api ./packages/api
RUN pnpm install --frozen-lockfile --offline \
  && pnpm --filter @chat-app/api build \
  && pnpm --filter @chat-app/api deploy --prod --offline --trust-lockfile /prod/api \
  && rm -rf /prod/api/node_modules/.pnpm/typescript@* \
  && find /prod/api/node_modules \( -name "typescript" -o -name "tsc" -o -name "tsserver" \) -exec rm -rf {} + \
  && find /prod/api -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.map" -o -name "*.tsbuildinfo" \) -delete

FROM node:24.11.1-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /prod/api ./
USER node
EXPOSE 3001
CMD ["node", "dist/src/server.js"]
