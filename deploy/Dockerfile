# syntax=docker/dockerfile:1.7
# =============================================================================
# Omni API — multi-stage arm64 image
# =============================================================================
# Build from the REPO ROOT (context must see packages/, apps/, bun.lock):
#
#   docker build --platform linux/arm64 -f deploy/Dockerfile -t omni-api:dev .
#
# Runtime is the bundled server produced by `packages/cli` scripts:
#   build:server      → dist/server/index.js  (bun bundle, target=bun)
#   build:migrations  → db/drizzle/           (applied on boot by the API)
#
# `build:server` EXTERNALIZES native/heavy deps (@anthropic-ai/claude-agent-sdk,
# @snazzah/davey, libsodium-wrappers, opusscript, pdf-parse, mammoth, exceljs,
# sharp). The runtime image therefore ships a `bun install --production`
# node_modules so those externalized requires resolve at runtime.
# =============================================================================

# Bun version must parse the repo's text bun.lock (lockfileVersion 1 → bun>=1.2);
# pinned to the toolchain that generated it. Override with --build-arg.
ARG BUN_VERSION=1.3.9

# ---- deps: full monorepo install (dev deps needed to build) -----------------
FROM oven/bun:${BUN_VERSION} AS deps
ENV HUSKY=0
WORKDIR /src
# Manifests first for better layer caching of the install step.
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps ./apps
# --ignore-scripts: skip the monorepo's postinstall (ensure-libicu-symlinks,
# husky) — irrelevant to producing the server bundle and its ICU symlinks would
# not carry to the separate runtime base anyway. Deps resolve on disk for the
# bundler regardless.
RUN bun install --frozen-lockfile --ignore-scripts

# ---- builder: bundle the server + copy migrations ---------------------------
FROM deps AS builder
WORKDIR /src/packages/cli
# Workspace packages resolve to their TS `src/` via package exports, so the
# server bundle is fully self-contained — no per-package pre-build needed.
RUN bun run build:server && bun run build:migrations

# ---- prod-deps: production node_modules for the externalized requires --------
# A clean, standalone install of packages/cli's `dependencies` only. The
# `@omni/*` workspace packages live in devDependencies, so `--production`
# skips them (they're already inlined in the bundle). `--ignore-scripts`
# avoids the CLI's global-pin postinstall; sharp/libsodium ship prebuilt
# arm64 binaries as (optional) deps, so no build scripts are required.
FROM oven/bun:${BUN_VERSION} AS prod-deps
WORKDIR /prod
COPY packages/cli/package.json ./orig-package.json
# Strip devDependencies (the `@omni/* workspace:*` entries): bun resolves the
# full graph even with --production and fails on workspace protocol outside the
# monorepo. Keep only `dependencies` — the externalized native deps live there.
RUN bun -e 'const p = await Bun.file("orig-package.json").json(); await Bun.write("package.json", JSON.stringify({ name: p.name, version: p.version, dependencies: p.dependencies }, null, 2));' \
  && bun install --production --ignore-scripts

# ---- runtime: slim, non-root ------------------------------------------------
FROM oven/bun:${BUN_VERSION}-slim AS runtime
# omni-api is stateless: creds/session live in Postgres, not on disk.
# PGSERVE_EMBEDDED/NATS_MANAGED=false → use external DATABASE_URL / NATS_URL
# instead of the in-process embedded pgserve / self-managed nats. HOME is an
# ephemeral writable dir (no PVC needed) for any home-relative scratch writes.
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=8882 \
    PGSERVE_EMBEDDED=false \
    NATS_MANAGED=false \
    HOME=/home/bun
WORKDIR /app

# Production deps + the server bundle + migrations.
COPY --from=prod-deps /prod/node_modules ./node_modules
COPY --from=prod-deps /prod/package.json ./package.json
COPY --from=builder   /src/packages/cli/dist/server ./dist/server
COPY --from=builder   /src/packages/cli/db/drizzle ./db/drizzle

# `bun` user (uid 1000) ships with the oven/bun image.
RUN mkdir -p /home/bun && chown -R bun:bun /app /home/bun
USER bun

# OCI metadata (org house style).
LABEL org.opencontainers.image.title="omni-api" \
      org.opencontainers.image.description="Omni multi-channel messaging API (Bun/Hono)" \
      org.opencontainers.image.source="https://github.com/automagik-dev/omni" \
      org.opencontainers.image.licenses="MIT"

EXPOSE 8882
# Health: GET /health → {"status":"healthy",...} once DB + NATS are reachable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:8882/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["bun", "dist/server/index.js"]
