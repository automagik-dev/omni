#!/usr/bin/env bash
# omni plugin — SessionStart hook
# Prints one-line server health status to stderr. Always exits 0.
set -euo pipefail

# ── Find omni CLI ────────────────────────────────────────────────────────────
find_omni() {
  if command -v omni >/dev/null 2>&1; then
    command -v omni
    return
  fi
  local bun_bin
  bun_bin="$(bun pm bin -g 2>/dev/null)" || true
  if [ -n "$bun_bin" ] && [ -x "$bun_bin/omni" ]; then
    echo "$bun_bin/omni"
    return
  fi
  return 1
}

OMNI=$(find_omni) || {
  echo "[omni] CLI not installed — run: bun add -g @automagik/omni" >&2
  exit 0
}

VERSION=$("$OMNI" --version 2>/dev/null || echo "?")

# ── Check server health (localhost only, no network) ─────────────────────────
STATUS_JSON=$("$OMNI" status --json 2>/dev/null) || STATUS_JSON=""

if [ -z "$STATUS_JSON" ]; then
  echo "[omni] v${VERSION} — server not running. Use /omni:install to set up." >&2
  exit 0
fi

# Parse health from JSON — count online PM2 processes (have "pid" field)
RUNNING=$(echo "$STATUS_JSON" | grep -c '"pid"' 2>/dev/null || true)
RUNNING="${RUNNING:-0}"
RUNNING="${RUNNING// /}"

# Check apiStatus field for health
if echo "$STATUS_JSON" | grep -q '"apiStatus".*"healthy"' 2>/dev/null; then
  echo "[omni] v${VERSION} — healthy (${RUNNING} services)" >&2
elif [ "${RUNNING:-0}" -gt 0 ] 2>/dev/null; then
  echo "[omni] v${VERSION} — ${RUNNING} services running (API not healthy)" >&2
else
  echo "[omni] v${VERSION} — server not running. Use /omni:install to set up." >&2
fi

exit 0
