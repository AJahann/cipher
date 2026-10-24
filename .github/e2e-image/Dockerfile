# Immutable official Node base; application files never enter this context.
FROM node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57
LABEL org.opencontainers.image.source="https://github.com/AJahann/cipher"
LABEL org.opencontainers.image.description="Public dependency-only Chromium shell for Cipher CI"
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_IMAGE_VERSION=1.63.0 \
    PNPM_HOME=/usr/local/share/pnpm
RUN apt-get update \
    && apt-get install -y --no-install-recommends git zstd \
    && npm install --global pnpm@12.6.0 @playwright/test@1.63.0 \
    && playwright install --with-deps --only-shell chromium \
    && chmod -R a+rX /ms-playwright \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/* /tmp/*
