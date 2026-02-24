#!/usr/bin/env bash
# omni plugin — Setup hook
# Auto-installs/updates @automagik/omni CLI via bun.
# Runs on plugin install and plugin update. Always exits 0.
set -euo pipefail

MARKER="${CLAUDE_PLUGIN_ROOT:-.}/.install-version"

log() { echo "[omni-setup] $*" >&2; }

# Extract bare semver from "2.260224.3 (server: ...)" output
parse_version() { echo "$1" | awk '{print $1}'; }

# ── Find bun ──────────────────────────────────────────────────────────────────
find_bun() {
  if command -v bun >/dev/null 2>&1; then
    command -v bun
    return
  fi
  for candidate in "$HOME/.bun/bin/bun" /usr/local/bin/bun; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return
    fi
  done
  return 1
}

BUN=$(find_bun) || {
  log "bun not found. Install it first:  curl -fsSL https://bun.sh/install | bash"
  exit 0
}

# ── Find or install omni CLI ─────────────────────────────────────────────────
find_omni() {
  if command -v omni >/dev/null 2>&1; then
    command -v omni
    return
  fi
  # bun global bin may not be in PATH yet
  local bun_bin
  bun_bin="$("$BUN" pm bin -g 2>/dev/null)" || true
  if [ -n "$bun_bin" ] && [ -x "$bun_bin/omni" ]; then
    echo "$bun_bin/omni"
    return
  fi
  return 1
}

OMNI=$(find_omni) || OMNI=""

if [ -z "$OMNI" ]; then
  log "Installing @automagik/omni CLI..."
  "$BUN" add -g @automagik/omni >&2 2>&1 || {
    log "Install failed — you can install manually: bun add -g @automagik/omni"
    exit 0
  }
  OMNI=$(find_omni) || {
    log "Installed but omni not found in PATH. Add bun global bin to your PATH."
    exit 0
  }
  INSTALLED_VERSION=$(parse_version "$("$OMNI" --version 2>/dev/null || echo "unknown")")
  log "Installed omni v${INSTALLED_VERSION}"
  echo "${INSTALLED_VERSION} $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$MARKER"
  exit 0
fi

# ── Already installed — check if update needed ───────────────────────────────
CURRENT_VERSION=$(parse_version "$("$OMNI" --version 2>/dev/null || echo "unknown")")

# If marker matches current version, skip (idempotent)
if [ -f "$MARKER" ]; then
  MARKER_VERSION=$(awk '{print $1}' "$MARKER" 2>/dev/null || echo "")
  if [ "$MARKER_VERSION" = "$CURRENT_VERSION" ]; then
    log "omni v${CURRENT_VERSION} — up to date"
    exit 0
  fi
fi

# Try self-update
log "Updating omni CLI (current: v${CURRENT_VERSION})..."
"$OMNI" update -y >&2 2>&1 || {
  log "Update failed — continuing with v${CURRENT_VERSION}"
}

UPDATED_VERSION=$(parse_version "$("$OMNI" --version 2>/dev/null || echo "$CURRENT_VERSION")")
echo "${UPDATED_VERSION} $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$MARKER"
log "omni v${UPDATED_VERSION} — ready"
exit 0
