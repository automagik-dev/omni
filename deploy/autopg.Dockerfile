# syntax=docker/dockerfile:1.7
# =============================================================================
# autopg — containerized Postgres 18 runtime (github.com/automagik-dev/autopg)
# =============================================================================
# autopg ships signed per-arch release tarballs but no container image. This
# Dockerfile turns the v${AUTOPG_VERSION} release tarball into the image run
# by the Helm chart (deploy/helm/omni/charts/autopg), mirroring the known-good
# local `autopg:dev` recipe.
#
# Build (download-only; needs no files from the build context):
#
#   docker build -f deploy/autopg.Dockerfile --platform linux/arm64 \
#     --build-arg AUTOPG_VERSION=3.0.7 -t autopg:dev deploy/
#
# Layout contract (from autopg's src/postgres.js at the same tag):
#   /usr/local/bin/autopg                              the autopg binary
#   $AUTOPG_CONFIG_DIR/bin/<platformKey>/{bin,lib,share}  postgres runtime
#   $AUTOPG_CONFIG_DIR/bin/<platformKey>/.version      MUST equal the
#     PINNED_PG_VERSION baked into that autopg release, or autopg discards
#     the runtime and re-downloads it from npm on boot.
# where <platformKey> is `linux-x64` (amd64) or `linux-arm64` (arm64).
# =============================================================================

ARG AUTOPG_VERSION=3.0.7
# Must match PINNED_PG_VERSION in autopg's src/postgres.js for the
# AUTOPG_VERSION above (v3.0.7 pins 18.3.0-beta.17). Bump both together.
ARG PG_RUNTIME_VERSION=18.3.0-beta.17

# ---- fetch: download, verify, and unpack the release tarball ----------------
# Runs on the build platform (no target-arch execution — pure download/copy).
FROM --platform=$BUILDPLATFORM debian:bookworm-slim AS fetch
ARG AUTOPG_VERSION
ARG PG_RUNTIME_VERSION
ARG TARGETARCH

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# Map TARGETARCH → release-asset suffix + autopg runtime platform key.
# amd64 uses the glibc build (final base is debian bookworm).
RUN set -eu; \
  case "${TARGETARCH}" in \
    amd64) ASSET_ARCH=linux-x64-glibc; PLATFORM_KEY=linux-x64 ;; \
    arm64) ASSET_ARCH=linux-arm64;     PLATFORM_KEY=linux-arm64 ;; \
    *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
  esac; \
  TARBALL="autopg-${AUTOPG_VERSION}-${ASSET_ARCH}.tar.gz"; \
  BASE_URL="https://github.com/automagik-dev/autopg/releases/download/v${AUTOPG_VERSION}"; \
  cd /tmp; \
  curl -fsSL -o "${TARBALL}" "${BASE_URL}/${TARBALL}"; \
  curl -fsSL -o "${TARBALL}.sha256" "${BASE_URL}/${TARBALL}.sha256"; \
  echo "$(cat "${TARBALL}.sha256")  ${TARBALL}" | sha256sum -c -; \
  mkdir -p /unpack; \
  tar -xzf "${TARBALL}" -C /unpack; \
  RUNTIME_DIR="/stage/var/lib/autopg/bin/${PLATFORM_KEY}"; \
  mkdir -p /stage/usr/local/bin "${RUNTIME_DIR}"; \
  mv /unpack/autopg/autopg /stage/usr/local/bin/autopg; \
  chmod 0755 /stage/usr/local/bin/autopg; \
  mv /unpack/autopg/postgres/bin /unpack/autopg/postgres/lib /unpack/autopg/postgres/share \
     "${RUNTIME_DIR}/"; \
  printf '%s\n' "${PG_RUNTIME_VERSION}" > "${RUNTIME_DIR}/.version"; \
  test -x "${RUNTIME_DIR}/bin/postgres"; \
  test -x "${RUNTIME_DIR}/bin/initdb"; \
  rm -rf /tmp/"${TARBALL}" /tmp/"${TARBALL}.sha256" /unpack

# ---- runtime -----------------------------------------------------------------
FROM debian:bookworm-slim
ARG AUTOPG_VERSION

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates postgresql-client \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -g 1000 autopg \
  && useradd -u 1000 -g 1000 -d /var/lib/autopg -s /usr/sbin/nologin autopg

ENV HOME=/var/lib/autopg \
    AUTOPG_CONFIG_DIR=/var/lib/autopg

COPY --from=fetch /stage/ /

RUN mkdir -p /var/lib/autopg/data /var/run/autopg \
  && chown -R autopg:autopg /var/lib/autopg /var/run/autopg

LABEL org.opencontainers.image.title="autopg" \
      org.opencontainers.image.description="autopg postmaster (embedded PostgreSQL 18) packaged from the automagik-dev/autopg release tarball" \
      org.opencontainers.image.source="https://github.com/automagik-dev/omni" \
      org.opencontainers.image.url="https://github.com/automagik-dev/autopg" \
      org.opencontainers.image.version="${AUTOPG_VERSION}"

USER autopg
WORKDIR /var/lib/autopg
EXPOSE 5432

ENTRYPOINT ["autopg", "postmaster"]
CMD ["--port", "5432", "--data", "/var/lib/autopg/data/pgdata", "--socket-dir", "/var/run/autopg", "--log", "info"]
