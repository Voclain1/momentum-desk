# syntax=docker/dockerfile:1
# One image for the web server, the background worker and migrations
# (decision D9; deploy/compose.yaml runs it three ways).
# PostgreSQL privileges are applied by the postgres image (deploy/grants.sh).

FROM node:22-bookworm-slim AS base
WORKDIR /app

FROM base AS build
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
COPY . .
# Only NEXT_PUBLIC_* values are baked into the browser bundle at build time.
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT
# Optional source map upload to Sentry: the token is a build secret, never
# stored in the image (deploy/compose.yaml passes it when set).
ARG SENTRY_ORG
ARG SENTRY_PROJECT
# lib/env.ts validates during the build. These placeholders exist only in this
# build step; the server and worker get the real values at run time.
RUN --mount=type=secret,id=sentry_auth_token,env=SENTRY_AUTH_TOKEN \
    DATABASE_URL=postgresql://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=build-step-placeholder-never-used-at-run-time \
    pnpm build

FROM base AS run
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app /app
ARG APP_VERSION
ENV APP_VERSION=${APP_VERSION}
USER node
EXPOSE 3000
# The web server by default; compose overrides this for the worker and migrations.
CMD ["node_modules/.bin/next", "start"]
