#!/usr/bin/env bash
# ============================================================================
# Omni v2 — Bootstrap installer
#
# Installs bun (if missing), the @automagik/omni CLI from npm on the channel
# the operator last used (latest|next from ~/.omni/config.json), then hands
# off to `omni install --non-interactive` for the rest of the setup wizard
# (NATS download, PM2 process registration, pgserve canonical backbone,
# instance prompts, AI provider config). Any future wizard work belongs in
# the TS installer, NOT in this bash script.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/automagik-dev/omni/main/install.sh | bash
#   curl -fsSL <…>/install.sh | bash -s -- --cli       # CLI only (no server bootstrap)
#   curl -fsSL <…>/install.sh | bash -s -- --server    # Default; runs full wizard
# ============================================================================
set -euo pipefail

PACKAGE='@automagik/omni'
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

ok()   { printf "${GREEN}✓${NC}  %s\n" "$*"; }
warn() { printf "${YELLOW}⚠${NC}  %s\n" "$*"; }
fail() { printf "${RED}✗${NC}  %s\n" "$*"; exit 1; }
has()  { command -v "$1" >/dev/null 2>&1; }

# Honor a previously-saved channel preference so reinstall doesn't silently
# downgrade an operator from @next to @latest. Defaults to latest.
resolve_channel() {
  local cfg="$HOME/.omni/config.json"
  if [[ -f "$cfg" ]] && grep -q '"updateChannel"[[:space:]]*:[[:space:]]*"next"' "$cfg" 2>/dev/null; then
    printf 'next'
  else
    printf 'latest'
  fi
}

ensure_bun() {
  if has bun; then ok "bun $(bun --version)"; return 0; fi
  printf "Installing bun...\n"
  curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  has bun || fail "bun install failed; install manually from https://bun.sh and re-run."
  ok "bun $(bun --version) installed"
}

install_cli() {
  local channel="$1"
  printf "Installing %s@%s...\n" "$PACKAGE" "$channel"
  bun add -g "${PACKAGE}@${channel}" >/dev/null 2>&1 || fail "bun add -g ${PACKAGE}@${channel} failed"
  has omni || fail "omni binary not on PATH after install; check \$PATH includes \$HOME/.bun/bin"
  ok "omni $(omni --version) installed (channel: ${channel})"
}

bootstrap_server() {
  # Hand the wizard off to TS — `omni install --non-interactive` owns
  # NATS download, PM2 registration, pgserve canonical backbone,
  # instance/provider prompts, and writing ~/.omni/config.json.
  printf "Running omni install --non-interactive...\n"
  omni install --non-interactive
}

main() {
  local mode="${1:-server}"
  if [[ "$mode" == "--help" || "$mode" == "-h" ]]; then
    printf "Usage: install.sh [--cli|--server]\n  --cli     CLI only (no server bootstrap)\n  --server  CLI + omni install --non-interactive (default)\n"
    exit 0
  fi
  ensure_bun
  local channel; channel="$(resolve_channel)"
  install_cli "$channel"
  [[ "$mode" != "--cli" ]] && bootstrap_server
  ok "Installation complete. Next: omni status, omni instances list, omni --help."
}

main "$@"
