#!/usr/bin/env bash
# ============================================================================
# Omni v2 — Universal Installer
# Usage: curl -fsSL https://felipe.omni.namastex.io/install.sh | bash
# ============================================================================
set -euo pipefail

VERSION="2.0.0"
REPO="https://github.com/automagik-dev/omni.git"
DEFAULT_API_URL="http://localhost:8882"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ============================================================================
# Helpers
# ============================================================================

info()    { printf "${BLUE}ℹ${NC}  %s\n" "$*"; }
ok()      { printf "${GREEN}✓${NC}  %s\n" "$*"; }
warn()    { printf "${YELLOW}⚠${NC}  %s\n" "$*"; }
fail()    { printf "${RED}✗${NC}  %s\n" "$*"; exit 1; }
step()    { printf "\n${BOLD}${CYAN}▸ %s${NC}\n" "$*"; }
dimline() { printf "${DIM}  %s${NC}\n" "$*"; }

has_cmd() { command -v "$1" >/dev/null 2>&1; }

ask_yn() {
  local prompt="$1" default="${2:-y}"
  local yn
  if [[ "$default" == "y" ]]; then
    printf "${BOLD}?${NC} %s ${DIM}[Y/n]${NC} " "$prompt"
  else
    printf "${BOLD}?${NC} %s ${DIM}[y/N]${NC} " "$prompt"
  fi
  read -r yn </dev/tty
  yn="${yn:-$default}"
  [[ "$yn" =~ ^[Yy] ]]
}

ask_input() {
  local prompt="$1" default="${2:-}"
  if [[ -n "$default" ]]; then
    printf "${BOLD}?${NC} %s ${DIM}[%s]${NC} " "$prompt" "$default"
  else
    printf "${BOLD}?${NC} %s " "$prompt"
  fi
  local val
  read -r val </dev/tty
  echo "${val:-$default}"
}

banner() {
  printf "\n"
  printf "${BOLD}${CYAN}"
  cat << 'EOF'
   ___  __  __ _  _ ___
  / _ \|  \/  | \| |_ _|
 | (_) | |\/| | .` || |
  \___/|_|  |_|_|\_|___|

EOF
  printf "${NC}"
  printf "  ${DIM}Universal Event-Driven Omnichannel Platform${NC}\n"
  printf "  ${DIM}v%s — installer${NC}\n\n" "$VERSION"
}

# ============================================================================
# Dependency checks
# ============================================================================

ensure_bun() {
  if has_cmd bun; then
    ok "bun $(bun --version)"
    return 0
  fi
  info "Installing bun..."
  curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  if has_cmd bun; then
    ok "bun $(bun --version) installed"
  else
    fail "Failed to install bun. Install manually: https://bun.sh"
  fi
}

ensure_git() {
  if has_cmd git; then
    ok "git $(git --version | awk '{print $3}')"
    return 0
  fi
  fail "git is required. Install it first:\n  macOS: xcode-select --install\n  Linux: sudo apt install git"
}

# ============================================================================
# Install modes
# ============================================================================

install_cli_only() {
  step "Installing Omni CLI (global)"

  local tmpdir
  tmpdir=$(mktemp -d)
  trap "rm -rf $tmpdir" EXIT

  info "Cloning repository..."
  git clone --depth 1 --filter=blob:none --sparse "$REPO" "$tmpdir/omni" 2>/dev/null
  cd "$tmpdir/omni"
  git sparse-checkout set packages/sdk packages/cli 2>/dev/null
  ok "Source downloaded"

  info "Installing dependencies..."
  cd packages/sdk
  bun install --frozen-lockfile 2>/dev/null || bun install 2>/dev/null
  bun run build 2>/dev/null
  ok "SDK built"

  cd ../cli
  bun install --frozen-lockfile 2>/dev/null || bun install 2>/dev/null
  bun run build 2>/dev/null
  ok "CLI built"

  info "Linking globally..."
  bun link 2>/dev/null
  ok "CLI linked"

  # Verify
  if has_cmd omni; then
    ok "omni command available"
  else
    # Fallback: install to ~/.omni/bin
    local bin_dir="$HOME/.omni/bin"
    mkdir -p "$bin_dir"
    cp -r "$tmpdir/omni/packages/cli" "$HOME/.omni/cli-pkg"
    cp -r "$tmpdir/omni/packages/sdk" "$HOME/.omni/sdk-pkg"
    cat > "$bin_dir/omni" << 'WRAPPER'
#!/usr/bin/env bash
exec bun "$HOME/.omni/cli-pkg/src/index.ts" "$@"
WRAPPER
    chmod +x "$bin_dir/omni"
    warn "bun link didn't work. Installed to ~/.omni/bin/omni"
    warn "Add to PATH: export PATH=\"\$HOME/.omni/bin:\$PATH\""
  fi

  trap - EXIT
  rm -rf "$tmpdir"
}

install_full_server() {
  step "Installing Omni v2 (full server)"

  local install_dir
  install_dir=$(ask_input "Install directory:" "$HOME/omni")

  if [[ -d "$install_dir/.git" ]]; then
    info "Existing install detected, pulling latest..."
    cd "$install_dir"
    git pull 2>/dev/null
  else
    info "Cloning repository..."
    git clone "$REPO" "$install_dir" 2>&1 | tail -1
    cd "$install_dir"
  fi
  ok "Repository ready"

  info "Running make install..."
  make install 2>&1 | tail -5
  ok "Dependencies installed + DB initialized"

  info "Downloading NATS..."
  make ensure-nats 2>&1 | tail -2
  ok "NATS ready"

  if ask_yn "Start services now?"; then
    make start 2>&1 | tail -8
    sleep 5
    local health
    health=$(curl -s http://localhost:8882/api/v2/health 2>/dev/null || echo '{"status":"error"}')
    if echo "$health" | grep -q '"healthy"'; then
      ok "Server is healthy!"
      # Extract API key from logs
      local api_key
      api_key=$(pm2 logs omni-v2-api --nostream --lines 50 2>&1 | grep -o 'omni_sk_[A-Za-z0-9]*' | head -1)
      if [[ -n "$api_key" ]]; then
        printf "\n"
        printf "  ${BOLD}API Key:${NC} ${GREEN}%s${NC}\n" "$api_key"
        printf "  ${YELLOW}Save this key — shown only once!${NC}\n"
      fi
    else
      warn "Server started but health check failed. Check: pm2 logs"
    fi
  fi
}

configure_cli() {
  step "Configuring CLI"

  local api_url api_key

  api_url=$(ask_input "Omni API URL:" "$DEFAULT_API_URL")
  api_key=$(ask_input "API Key (omni_sk_...):" "")

  if [[ -z "$api_key" ]]; then
    warn "No API key provided. Set later with: omni auth login --api-key <key>"
  fi

  # Write config
  local config_dir="$HOME/.omni"
  mkdir -p "$config_dir"
  cat > "$config_dir/config.json" << EOF
{
  "apiUrl": "$api_url",
  "apiKey": "$api_key",
  "format": "human"
}
EOF
  chmod 600 "$config_dir/config.json"
  ok "Config saved to ~/.omni/config.json"

  # Test connection
  if [[ -n "$api_key" ]]; then
    info "Testing connection..."
    local health
    health=$(curl -s -H "Authorization: Bearer $api_key" "$api_url/api/v2/health" 2>/dev/null || echo "")
    if echo "$health" | grep -q '"healthy"'; then
      ok "Connected to Omni at $api_url"
    else
      warn "Could not connect to $api_url — check URL and API key"
    fi
  fi
}

# ============================================================================
# Wizard
# ============================================================================

wizard() {
  banner

  printf "${BOLD}What would you like to install?${NC}\n\n"
  printf "  ${CYAN}1)${NC} ${BOLD}CLI only${NC}       — Control a remote Omni server from this machine\n"
  printf "  ${CYAN}2)${NC} ${BOLD}Full server${NC}    — Install Omni v2 + services (PostgreSQL, NATS, API)\n"
  printf "  ${CYAN}3)${NC} ${BOLD}CLI + connect${NC}  — Install CLI and configure remote server\n"
  printf "\n"

  local choice
  choice=$(ask_input "Choose [1/2/3]:" "1")

  # Check dependencies
  step "Checking dependencies"
  ensure_git
  ensure_bun

  case "$choice" in
    1)
      install_cli_only
      printf "\n"
      if ask_yn "Configure connection to a remote server now?"; then
        configure_cli
      fi
      ;;
    2)
      install_full_server
      ;;
    3)
      install_cli_only
      configure_cli
      ;;
    *)
      fail "Invalid choice: $choice"
      ;;
  esac

  # Done
  printf "\n"
  printf "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
  printf "${BOLD}${GREEN}  ✓ Installation complete!${NC}\n"
  printf "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
  printf "\n"
  printf "  ${BOLD}Quick start:${NC}\n"
  printf "    omni status              Check connection\n"
  printf "    omni instances list      List channel instances\n"
  printf "    omni send --help         Send a message\n"
  printf "    omni chats list          List conversations\n"
  printf "\n"
  printf "  ${DIM}Docs: https://github.com/automagik-dev/omni${NC}\n"
  printf "\n"
}

# ============================================================================
# CLI flags (non-interactive)
# ============================================================================

if [[ "${1:-}" == "--cli" ]]; then
  ensure_git
  ensure_bun
  install_cli_only
  if [[ -n "${2:-}" ]]; then
    DEFAULT_API_URL="$2"
    configure_cli
  fi
  exit 0
fi

if [[ "${1:-}" == "--server" ]]; then
  ensure_git
  ensure_bun
  install_full_server
  exit 0
fi

if [[ "${1:-}" == "--help" ]] || [[ "${1:-}" == "-h" ]]; then
  banner
  printf "Usage:\n"
  printf "  curl -fsSL <url>/install.sh | bash          Interactive wizard\n"
  printf "  curl -fsSL <url>/install.sh | bash -s -- --cli [api-url]   CLI only\n"
  printf "  curl -fsSL <url>/install.sh | bash -s -- --server          Full server\n"
  printf "\n"
  exit 0
fi

# Default: run wizard
wizard
