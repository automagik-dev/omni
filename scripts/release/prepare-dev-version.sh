#!/usr/bin/env bash
# =============================================================================
# Derive the next dev version from this checkout's tags and write every
# version file for it. Run from the repository root.
# =============================================================================
# version.yml "Commit and tag" runs this once per bump attempt. When git
# rejects the dev push as non-fast-forward, the step resets to the fresh tip,
# deletes its unpushed local tag and runs this again, so a retry always
# recomputes the number from the fresh tags and never reuses a stale one.
#
# stdout: the derived version, alone on the last line. Tool output: stderr.
set -euo pipefail

TODAY=$(date -u +%y%m%d)
EXISTING=$(git tag --list "v2.${TODAY}.*" | wc -l)
BUILD_NUMBER=$((EXISTING + 1))
VERSION="2.${TODAY}.${BUILD_NUMBER}"
echo "Derived version: ${VERSION}" >&2

{
  OMNI_BUILD_NUMBER="${BUILD_NUMBER}" bun scripts/generate-version.ts

  # Omni's own DSH plugins (apps/*-dsh) move to this version only when their
  # folder changed since the release their version names (its tag; the
  # checkout has every tag): each carries the Omni version of its last change
  # (scripts/lib/plugin-versions.ts). Also stamps the chart appVersion.
  bun scripts/sync-versions.ts "${VERSION}"

  # bun.lock pins every workspace package's version explicitly, so a stale
  # lockfile makes `bun install --frozen-lockfile` fail in build-tarballs.yml.
  # A pure rewrite of workspace deps; no external resolution changes.
  bun install
} >&2

printf '%s\n' "${VERSION}"
