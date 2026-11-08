# The web app on Railway. A Dockerfile instead of Railpack so a build never downloads
# tools from GitHub releases (Railpack fetches itself and mise from there on every build,
# and a GitHub release outage on 8 Nov 2026 failed every deploy). Node comes from Docker
# Hub, pnpm from the npm registry through corepack, pinned by package.json.

FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
# Workspace manifests first, so dependency installs are cached across source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/verify/package.json packages/verify/
COPY web/package.json web/
COPY spikes/s3-secrets/package.json spikes/s3-secrets/
COPY spikes/s6-chainsig-match/package.json spikes/s6-chainsig-match/
RUN pnpm install --frozen-lockfile --filter web... --filter @proveit/verify
COPY packages/verify packages/verify
COPY test-vectors test-vectors
COPY web web
# NEXT_PUBLIC_* values are baked in at build time; Railway passes service variables as
# build args. Unset, the app uses its testnet defaults (web/lib/config.ts).
ARG NEXT_PUBLIC_NETWORK NEXT_PUBLIC_REGISTRY NEXT_PUBLIC_DEMO_REGISTRY NEXT_PUBLIC_ENCLAVE_PROJECT \
    NEXT_PUBLIC_OUTLAYER_API NEXT_PUBLIC_OUTLAYER_CONTRACT NEXT_PUBLIC_NEAR_RPC NEXT_PUBLIC_EXPLORER \
    NEXT_PUBLIC_SITE_URL NEXT_PUBLIC_FEATURED_CARD
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
COPY --from=build /app /app
# Railway sets PORT; next start listens on it.
CMD ["pnpm", "--filter", "web", "start"]
