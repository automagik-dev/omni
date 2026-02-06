#!/usr/bin/env bash
# ============================================================================
# Omni v2 — Universal Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/automagik-dev/omni/main/install.sh | bash
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

has_cmd() { command -v "$1" >/dev/null 2>&1; }

ask_yn() {
  local prompt="$1" default="${2:-y}"
  local yn
  if [[ "$default" == "y" ]]; then
    printf "${BOLD}?${NC} %s ${DIM}[Y/n]${NC} " "$prompt" >/dev/tty
  else
    printf "${BOLD}?${NC} %s ${DIM}[y/N]${NC} " "$prompt" >/dev/tty
  fi
  read -r yn </dev/tty
  yn="${yn:-$default}"
  [[ "$yn" =~ ^[Yy] ]]
}

ask_input() {
  local prompt="$1" default="${2:-}"
  if [[ -n "$default" ]]; then
    printf "${BOLD}?${NC} %s ${DIM}[%s]${NC} " "$prompt" "$default" >/dev/tty
  else
    printf "${BOLD}?${NC} %s " "$prompt" >/dev/tty
  fi
  local val
  read -r val </dev/tty
  echo "${val:-$default}"
}

ask_secret() {
  local prompt="$1" default="${2:-}"
  if [[ -n "$default" ]]; then
    local masked="${default:0:10}...${default: -4}"
    printf "${BOLD}?${NC} %s ${DIM}[%s]${NC} " "$prompt" "$masked" >/dev/tty
  else
    printf "${BOLD}?${NC} %s " "$prompt" >/dev/tty
  fi
  local val
  read -r val </dev/tty
  echo "${val:-$default}"
}

ask_choice() {
  local prompt="$1"
  shift
  local options=("$@")
  printf "${BOLD}?${NC} %s\n" "$prompt" >/dev/tty
  local i=1
  for opt in "${options[@]}"; do
    printf "  ${CYAN}%d)${NC} %s\n" "$i" "$opt" >/dev/tty
    ((i++))
  done
  printf "${BOLD}?${NC} ${DIM}[1-%d]${NC} " "${#options[@]}" >/dev/tty
  local choice
  read -r choice </dev/tty
  echo "${choice:-1}"
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
  # Source bashrc for bun path
  [[ -f "$HOME/.bashrc" ]] && source "$HOME/.bashrc" 2>/dev/null || true
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

  info "Cloning repository (sparse — CLI + SDK only)..."
  git clone --depth 1 --filter=blob:none --sparse "$REPO" "$tmpdir/omni" 2>/dev/null
  cd "$tmpdir/omni"
  git sparse-checkout set packages/sdk packages/cli 2>/dev/null
  ok "Source downloaded"

  info "Building SDK..."
  cd packages/sdk
  bun install --frozen-lockfile 2>/dev/null || bun install 2>/dev/null
  bun run build 2>/dev/null
  ok "SDK built"

  info "Building CLI..."
  cd ../cli
  bun install --frozen-lockfile 2>/dev/null || bun install 2>/dev/null
  bun run build 2>/dev/null
  ok "CLI built"

  info "Linking globally..."
  bun link 2>/dev/null
  ok "CLI linked"

  # Verify
  if has_cmd omni; then
    ok "'omni' command available"
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
    warn "bun link didn't register in PATH. Installed to ~/.omni/bin/omni"
    warn "Add to your shell: export PATH=\"\$HOME/.omni/bin:\$PATH\""
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
  ok "Repository ready at $install_dir"

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

        # Auto-configure CLI
        mkdir -p "$HOME/.omni"
        cat > "$HOME/.omni/config.json" << EOF
{
  "apiUrl": "http://localhost:8882",
  "apiKey": "$api_key",
  "format": "human"
}
EOF
        chmod 600 "$HOME/.omni/config.json"
        ok "CLI auto-configured with local server"
      fi
    else
      warn "Server started but health check failed. Check: pm2 logs"
    fi
  fi
}

# ============================================================================
# Post-install: Configure connection
# ============================================================================

configure_connection() {
  step "Configure connection"

  local api_url api_key

  api_url=$(ask_input "Omni API URL:" "$DEFAULT_API_URL")
  api_key=$(ask_secret "API Key (omni_sk_...):" "")

  if [[ -z "$api_key" ]]; then
    warn "No API key provided. Set later with: omni auth login --api-key <key>"
    return 1
  fi

  # Write config
  mkdir -p "$HOME/.omni"
  cat > "$HOME/.omni/config.json" << EOF
{
  "apiUrl": "$api_url",
  "apiKey": "$api_key",
  "format": "human"
}
EOF
  chmod 600 "$HOME/.omni/config.json"
  ok "Config saved to ~/.omni/config.json"

  # Test connection
  info "Testing connection..."
  local health
  health=$(curl -s -H "Authorization: Bearer $api_key" "$api_url/api/v2/health" 2>/dev/null || echo "")
  if echo "$health" | grep -q '"healthy"'; then
    ok "Connected to Omni at $api_url"
    local version
    version=$(echo "$health" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
    [[ -n "$version" ]] && info "Server version: $version"
    return 0
  else
    warn "Could not connect to $api_url"
    warn "Check the URL and API key. You can update later with: omni config set apiUrl <url>"
    return 1
  fi
}

# ============================================================================
# Post-install: Setup wizard (optional steps)
# ============================================================================

setup_wizard() {
  local api_url api_key
  api_url=$(grep -o '"apiUrl"[[:space:]]*:[[:space:]]*"[^"]*"' "$HOME/.omni/config.json" 2>/dev/null | cut -d'"' -f4)
  api_key=$(grep -o '"apiKey"[[:space:]]*:[[:space:]]*"[^"]*"' "$HOME/.omni/config.json" 2>/dev/null | cut -d'"' -f4)

  if [[ -z "$api_url" ]] || [[ -z "$api_key" ]]; then
    return 0
  fi

  local auth_header="Authorization: Bearer $api_key"

  # ── Create a WhatsApp instance ──────────────────────────────────────
  printf "\n"
  if ask_yn "Create a WhatsApp instance?" "n"; then
    step "Creating WhatsApp instance"

    local instance_name
    instance_name=$(ask_input "Instance name:" "my-whatsapp")

    info "Creating instance '$instance_name'..."
    local result
    result=$(curl -s -X POST "$api_url/api/v2/instances" \
      -H "$auth_header" \
      -H "Content-Type: application/json" \
      -d "{\"name\": \"$instance_name\", \"channel\": \"whatsapp-baileys\"}" 2>/dev/null)

    local instance_id
    instance_id=$(echo "$result" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

    if [[ -n "$instance_id" ]]; then
      ok "Instance created: $instance_id"

      # Set as default
      if has_cmd omni; then
        omni config set defaultInstance "$instance_id" 2>/dev/null || true
      else
        # Update config directly
        local tmp
        tmp=$(mktemp)
        python3 -c "
import json
c = json.load(open('$HOME/.omni/config.json'))
c['defaultInstance'] = '$instance_id'
json.dump(c, open('$tmp', 'w'), indent=2)
" 2>/dev/null && mv "$tmp" "$HOME/.omni/config.json" && chmod 600 "$HOME/.omni/config.json"
      fi
      ok "Set as default instance"

      # Offer QR code pairing
      if ask_yn "Pair via QR code now? (opens in terminal)"; then
        info "Fetching QR code... (scan with WhatsApp > Linked Devices > Link a Device)"
        printf "\n"
        local qr_result
        qr_result=$(curl -s "$api_url/api/v2/instances/$instance_id/qr" \
          -H "$auth_header" 2>/dev/null)
        local qr_code
        qr_code=$(echo "$qr_result" | grep -o '"qr":"[^"]*"' | cut -d'"' -f4)

        if [[ -n "$qr_code" ]]; then
          # Try to render QR in terminal using node/bun
          if has_cmd bun; then
            bun -e "const q=require('qrcode-terminal');q.generate('$qr_code',{small:true})" 2>/dev/null || echo "$qr_code"
          elif has_cmd node; then
            node -e "try{require('qrcode-terminal').generate('$qr_code',{small:true})}catch{console.log('$qr_code')}" 2>/dev/null || echo "$qr_code"
          else
            echo "$qr_code"
          fi
          printf "\n"
          info "Waiting for scan... (press Enter when done)"
          read -r </dev/tty

          # Check status
          local status_result
          status_result=$(curl -s "$api_url/api/v2/instances/$instance_id" \
            -H "$auth_header" 2>/dev/null)
          if echo "$status_result" | grep -q '"isActive":true'; then
            ok "WhatsApp connected!"
          else
            warn "Not connected yet. Check later: omni instances status $instance_id"
          fi
        else
          local error_msg
          error_msg=$(echo "$qr_result" | grep -o '"message":"[^"]*"' | cut -d'"' -f4)
          if [[ -n "$error_msg" ]]; then
            warn "QR not available: $error_msg"
          else
            warn "QR code not available yet. Try: omni instances qr $instance_id"
          fi
        fi
      fi

      # Offer phone number pairing
      if ! echo "${status_result:-}" | grep -q '"isActive":true' 2>/dev/null; then
        if ask_yn "Pair via phone number instead?" "n"; then
          local phone
          phone=$(ask_input "Phone number (with country code, e.g. +5511999999999):" "")
          if [[ -n "$phone" ]]; then
            info "Requesting pairing code for $phone..."
            local pair_result
            pair_result=$(curl -s -X POST "$api_url/api/v2/instances/$instance_id/pair" \
              -H "$auth_header" \
              -H "Content-Type: application/json" \
              -d "{\"phone\": \"$phone\"}" 2>/dev/null)
            local pair_code
            pair_code=$(echo "$pair_result" | grep -o '"code":"[^"]*"' | cut -d'"' -f4)
            if [[ -n "$pair_code" ]]; then
              printf "\n  ${BOLD}Pairing code: ${GREEN}%s${NC}\n\n" "$pair_code"
              info "Enter this code in WhatsApp > Linked Devices > Link a Device > Link with phone number"
            else
              warn "Could not get pairing code. Try: omni instances pair $instance_id --phone $phone"
            fi
          fi
        fi
      fi
    else
      local error_msg
      error_msg=$(echo "$result" | grep -o '"message":"[^"]*"' | cut -d'"' -f4)
      warn "Failed to create instance: ${error_msg:-unknown error}"
    fi
  fi

  # ── Create a Discord instance ───────────────────────────────────────
  if ask_yn "Create a Discord instance?" "n"; then
    step "Creating Discord instance"

    local discord_name discord_token
    discord_name=$(ask_input "Instance name:" "my-discord")
    discord_token=$(ask_secret "Discord bot token:" "")

    if [[ -n "$discord_token" ]]; then
      info "Creating Discord instance..."
      local result
      result=$(curl -s -X POST "$api_url/api/v2/instances" \
        -H "$auth_header" \
        -H "Content-Type: application/json" \
        -d "{\"name\": \"$discord_name\", \"channel\": \"discord\", \"config\": {\"token\": \"$discord_token\"}}" 2>/dev/null)

      if echo "$result" | grep -q '"id"'; then
        ok "Discord instance created"
      else
        warn "Failed to create Discord instance"
      fi
    else
      warn "No token provided. Create later: omni instances create --name $discord_name --channel discord"
    fi
  fi

  # ── Set default output format ───────────────────────────────────────
  if ask_yn "Configure output format?" "n"; then
    local fmt_choice
    fmt_choice=$(ask_choice "Output format:" "human (colored, tables)" "json (machine-readable)")
    local fmt="human"
    [[ "$fmt_choice" == "2" ]] && fmt="json"

    local tmp
    tmp=$(mktemp)
    python3 -c "
import json
c = json.load(open('$HOME/.omni/config.json'))
c['format'] = '$fmt'
json.dump(c, open('$tmp', 'w'), indent=2)
" 2>/dev/null && mv "$tmp" "$HOME/.omni/config.json" && chmod 600 "$HOME/.omni/config.json"
    ok "Output format set to: $fmt"
  fi

  # ── Configure an AI provider ────────────────────────────────────────
  if ask_yn "Configure an AI provider (for auto-replies)?" "n"; then
    step "AI Provider setup"

    local provider_choice
    provider_choice=$(ask_choice "Provider type:" "OpenAI" "Anthropic" "Custom")

    local schema="openai" provider_name="" provider_url="" provider_key=""

    case "$provider_choice" in
      1)
        schema="openai"
        provider_name=$(ask_input "Provider name:" "openai")
        provider_url="https://api.openai.com/v1"
        provider_key=$(ask_secret "OpenAI API key:" "")
        ;;
      2)
        schema="anthropic"
        provider_name=$(ask_input "Provider name:" "anthropic")
        provider_url="https://api.anthropic.com"
        provider_key=$(ask_secret "Anthropic API key:" "")
        ;;
      3)
        schema="openai"
        provider_name=$(ask_input "Provider name:" "my-provider")
        provider_url=$(ask_input "Base URL:" "")
        provider_key=$(ask_secret "API key:" "")
        ;;
    esac

    if [[ -n "$provider_key" ]] && [[ -n "$provider_url" ]]; then
      info "Creating provider '$provider_name'..."
      local result
      result=$(curl -s -X POST "$api_url/api/v2/providers" \
        -H "$auth_header" \
        -H "Content-Type: application/json" \
        -d "{\"name\": \"$provider_name\", \"schema\": \"$schema\", \"baseUrl\": \"$provider_url\", \"apiKey\": \"$provider_key\"}" 2>/dev/null)

      if echo "$result" | grep -q '"id"'; then
        ok "Provider '$provider_name' created"
      else
        warn "Failed to create provider. Set up later: omni providers create --help"
      fi
    else
      warn "Incomplete config. Set up later: omni providers create --help"
    fi
  fi

  # ── Send a test message ─────────────────────────────────────────────
  local instances_json
  instances_json=$(curl -s "$api_url/api/v2/instances" -H "$auth_header" 2>/dev/null)
  local has_active
  has_active=$(echo "$instances_json" | grep -c '"isActive":true' 2>/dev/null || echo "0")

  if [[ "$has_active" -gt 0 ]]; then
    if ask_yn "Send a test message?" "n"; then
      local test_to test_text
      test_to=$(ask_input "Send to (phone with country code):" "")
      test_text=$(ask_input "Message:" "Hello from Omni! 🚀")

      if [[ -n "$test_to" ]]; then
        info "Sending message..."
        local send_result
        send_result=$(curl -s -X POST "$api_url/api/v2/messages/send" \
          -H "$auth_header" \
          -H "Content-Type: application/json" \
          -d "{\"to\": \"$test_to\", \"content\": {\"text\": \"$test_text\"}}" 2>/dev/null)

        if echo "$send_result" | grep -q '"id"'; then
          ok "Message sent!"
        else
          local error_msg
          error_msg=$(echo "$send_result" | grep -o '"message":"[^"]*"' | cut -d'"' -f4)
          warn "Send failed: ${error_msg:-unknown error}"
        fi
      fi
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
  printf "  ${CYAN}2)${NC} ${BOLD}Full server${NC}    — Install Omni v2 + all services locally\n"
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
      if ask_yn "Configure connection to a remote server?"; then
        if configure_connection; then
          setup_wizard
        fi
      fi
      ;;
    2)
      install_full_server
      printf "\n"
      if ask_yn "Run setup wizard?"; then
        setup_wizard
      fi
      ;;
    3)
      install_cli_only
      if configure_connection; then
        setup_wizard
      fi
      ;;
    *)
      fail "Invalid choice: $choice"
      ;;
  esac

  # ── Summary ───────────────────────────────────────────────────────
  printf "\n"
  printf "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
  printf "${BOLD}${GREEN}  ✓ Installation complete!${NC}\n"
  printf "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
  printf "\n"

  # Show config
  if [[ -f "$HOME/.omni/config.json" ]]; then
    local saved_url saved_instance
    saved_url=$(grep -o '"apiUrl"[[:space:]]*:[[:space:]]*"[^"]*"' "$HOME/.omni/config.json" | cut -d'"' -f4)
    saved_instance=$(grep -o '"defaultInstance"[[:space:]]*:[[:space:]]*"[^"]*"' "$HOME/.omni/config.json" 2>/dev/null | cut -d'"' -f4)
    printf "  ${DIM}Server:${NC}    %s\n" "${saved_url:-not configured}"
    [[ -n "$saved_instance" ]] && printf "  ${DIM}Instance:${NC}  %s\n" "$saved_instance"
    printf "  ${DIM}Config:${NC}    ~/.omni/config.json\n"
    printf "\n"
  fi

  printf "  ${BOLD}Commands:${NC}\n"
  printf "    omni status              Check connection\n"
  printf "    omni instances list      List channel instances\n"
  printf "    omni chats list          List conversations\n"
  printf "    omni send --help         Send a message\n"
  printf "    omni --help              All commands\n"
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
    configure_connection
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
  printf "  curl -fsSL <url>/install.sh | bash                             Interactive wizard\n"
  printf "  curl -fsSL <url>/install.sh | bash -s -- --cli                 CLI only (no prompts)\n"
  printf "  curl -fsSL <url>/install.sh | bash -s -- --cli <api-url>       CLI + configure remote\n"
  printf "  curl -fsSL <url>/install.sh | bash -s -- --server              Full server install\n"
  printf "\n"
  exit 0
fi

# Default: run wizard
wizard
