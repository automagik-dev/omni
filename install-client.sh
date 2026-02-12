#!/usr/bin/env bash
# ============================================================================
# Omni v2 — CLI Client Installer (autonomous, non-interactive)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/automagik-dev/omni/main/install-client.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/automagik-dev/omni/dev/install-client.sh | bash -s -- --dev
#
# Options:
#   --dev       Fetch from dev branch instead of main
#   --force     Overwrite existing installation
#   --no-color  Disable colored output
#
# What it does:
#   1. Ensures bun is installed
#   2. Sparse-clones only packages/cli + packages/sdk from the repo
#   3. Installs deps, builds SDK, builds CLI
#   4. Compiles a standalone binary to ~/.omni/bin/omni
#   5. Preserves existing ~/.omni/config.json
# ============================================================================
set -euo pipefail

REPO="https://github.com/automagik-dev/omni.git"
BRANCH="main"
INSTALL_DIR="$HOME/.omni"
BIN_DIR="$INSTALL_DIR/bin"
FORCE=false

# Colors (can be disabled with --no-color)
if [[ "${NO_COLOR:-}" == "1" ]] || [[ "${1:-}" == "--no-color" ]]; then
  RED="" GREEN="" YELLOW="" BLUE="" CYAN="" BOLD="" DIM="" NC=""
else
  RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m'
  BLUE='\033[0;34m' CYAN='\033[0;36m' BOLD='\033[1m' DIM='\033[2m' NC='\033[0m'
fi

info()  { printf "${BLUE}ℹ${NC}  %s\n" "$*"; }
ok()    { printf "${GREEN}✓${NC}  %s\n" "$*"; }
warn()  { printf "${YELLOW}⚠${NC}  %s\n" "$*"; }
fail()  { printf "${RED}✗${NC}  %s\n" "$*"; exit 1; }
step()  { printf "\n${BOLD}${CYAN}▸ %s${NC}\n" "$*"; }

has_cmd() { command -v "$1" >/dev/null 2>&1; }

# ============================================================================
# Parse args
# ============================================================================

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev)      BRANCH="dev"; shift ;;
    --force)    FORCE=true; shift ;;
    --no-color) shift ;;  # already handled above
    --help|-h)
      printf "Usage: install-client.sh [--dev] [--force] [--no-color]\n"
      printf "  --dev     Install from dev branch\n"
      printf "  --force   Overwrite existing installation\n"
      exit 0
      ;;
    *) warn "Unknown option: $1"; shift ;;
  esac
done

# ============================================================================
# Banner
# ============================================================================

printf "\n${BOLD}${CYAN}"
cat << 'EOF'
   ___  __  __ _  _ ___
  / _ \|  \/  | \| |_ _|
 | (_) | |\/| | .` || |
  \___/|_|  |_|_|\_|___|
EOF
printf "${NC}"
printf "  ${DIM}CLI Client Installer — branch: ${BRANCH}${NC}\n\n"

# ============================================================================
# Check existing installation
# ============================================================================

if [[ -f "$BIN_DIR/omni" ]] && [[ "$FORCE" != "true" ]]; then
  CURRENT_VERSION=$("$BIN_DIR/omni" --version 2>/dev/null || echo "unknown")
  info "Existing installation found: $CURRENT_VERSION"
  info "Updating from ${BRANCH}..."
fi

# ============================================================================
# Ensure dependencies
# ============================================================================

step "Checking dependencies"

# git
if has_cmd git; then
  ok "git $(git --version | awk '{print $3}')"
else
  fail "git is required. Install: macOS → xcode-select --install | Linux → sudo apt install git"
fi

# bun
if has_cmd bun; then
  ok "bun $(bun --version)"
else
  info "Installing bun..."
  curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  # Source shell config to pick up bun
  for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
    [[ -f "$rc" ]] && source "$rc" 2>/dev/null || true
  done
  if has_cmd bun; then
    ok "bun $(bun --version) installed"
  else
    fail "Failed to install bun. Install manually: https://bun.sh"
  fi
fi

# ============================================================================
# Clone (sparse — CLI + SDK only)
# ============================================================================

step "Fetching source (${BRANCH})"

TMPDIR=$(mktemp -d)
cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT

info "Sparse clone (packages/cli + packages/sdk + packages/core)..."
git clone --depth 1 --branch "$BRANCH" --filter=blob:none --sparse \
  "$REPO" "$TMPDIR/omni" 2>&1 | tail -1 || fail "Clone failed"

cd "$TMPDIR/omni"
git sparse-checkout set packages/sdk packages/cli packages/core packages/db 2>/dev/null
ok "Source fetched ($(git rev-parse --short HEAD))"

COMMIT_SHA=$(git rev-parse --short HEAD)
COMMIT_DATE=$(git log -1 --format=%ci | cut -d' ' -f1)

# ============================================================================
# Build
# ============================================================================

step "Building"

info "Installing dependencies..."
bun install --frozen-lockfile 2>/dev/null || bun install 2>/dev/null
ok "Dependencies installed"

# Build SDK first (CLI depends on it)
if [[ -d packages/sdk ]]; then
  info "Building SDK..."
  cd packages/sdk
  bun run build 2>/dev/null
  cd "$TMPDIR/omni"
  ok "SDK built"
fi

# Build CLI
info "Building CLI..."
cd packages/cli
bun run build 2>/dev/null
ok "CLI built"

# Compile standalone binary
info "Compiling standalone binary..."
cd "$TMPDIR/omni"
bun build packages/cli/src/index.ts --compile --outfile "$TMPDIR/omni-bin" 2>/dev/null

if [[ -f "$TMPDIR/omni-bin" ]]; then
  ok "Binary compiled ($(du -sh "$TMPDIR/omni-bin" | awk '{print $1}'))"
else
  # Fallback: wrapper script that runs via bun
  warn "Standalone compile failed, using bun wrapper"
  mkdir -p "$INSTALL_DIR/cli-pkg" "$INSTALL_DIR/sdk-pkg"
  cp -r "$TMPDIR/omni/packages/cli/"* "$INSTALL_DIR/cli-pkg/"
  cp -r "$TMPDIR/omni/packages/sdk/"* "$INSTALL_DIR/sdk-pkg/"
  cat > "$TMPDIR/omni-bin" << 'WRAPPER'
#!/usr/bin/env bash
exec bun "$HOME/.omni/cli-pkg/src/index.ts" "$@"
WRAPPER
  chmod +x "$TMPDIR/omni-bin"
  ok "Wrapper script created"
fi

# ============================================================================
# Install
# ============================================================================

step "Installing"

mkdir -p "$BIN_DIR"

# Backup existing binary
if [[ -f "$BIN_DIR/omni" ]]; then
  cp "$BIN_DIR/omni" "$BIN_DIR/omni.bak" 2>/dev/null || true
fi

# Install new binary
cp "$TMPDIR/omni-bin" "$BIN_DIR/omni"
chmod +x "$BIN_DIR/omni"
ok "Installed to $BIN_DIR/omni"

# ============================================================================
# PATH check
# ============================================================================

if ! echo "$PATH" | grep -q "$BIN_DIR"; then
  warn "$BIN_DIR is not in your PATH"
  
  # Try to add to shell config
  SHELL_RC=""
  if [[ -n "${ZSH_VERSION:-}" ]] || [[ "$SHELL" == *"zsh"* ]]; then
    SHELL_RC="$HOME/.zshrc"
  elif [[ -n "${BASH_VERSION:-}" ]] || [[ "$SHELL" == *"bash"* ]]; then
    SHELL_RC="$HOME/.bashrc"
  fi

  if [[ -n "$SHELL_RC" ]] && [[ -f "$SHELL_RC" ]]; then
    if ! grep -q '.omni/bin' "$SHELL_RC" 2>/dev/null; then
      printf '\n# Omni CLI\nexport PATH="$HOME/.omni/bin:$PATH"\n' >> "$SHELL_RC"
      ok "Added to $SHELL_RC — restart your shell or: source $SHELL_RC"
    fi
  else
    info "Add to your shell config: export PATH=\"\$HOME/.omni/bin:\$PATH\""
  fi
  
  export PATH="$BIN_DIR:$PATH"
fi

# ============================================================================
# Verify
# ============================================================================

step "Verifying"

if has_cmd omni || [[ -x "$BIN_DIR/omni" ]]; then
  INSTALLED_VERSION=$("$BIN_DIR/omni" --version 2>/dev/null || echo "unknown")
  ok "omni ${INSTALLED_VERSION} (${BRANCH}@${COMMIT_SHA} ${COMMIT_DATE})"
else
  fail "Installation failed — binary not found"
fi

# Check existing config
if [[ -f "$INSTALL_DIR/config.json" ]]; then
  API_URL=$(grep -o '"apiUrl"[[:space:]]*:[[:space:]]*"[^"]*"' "$INSTALL_DIR/config.json" 2>/dev/null | cut -d'"' -f4)
  ok "Config preserved → ${API_URL:-unconfigured}"
else
  info "No config found. Configure with: omni config set --api-url <url> --api-key <key>"
fi

# ============================================================================
# Done
# ============================================================================

printf "\n"
printf "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
printf "${BOLD}${GREEN}  ✓ Omni CLI installed (${BRANCH}@${COMMIT_SHA})${NC}\n"
printf "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
printf "\n"
printf "  ${DIM}Binary:${NC}  %s\n" "$BIN_DIR/omni"
printf "  ${DIM}Config:${NC}  %s\n" "$INSTALL_DIR/config.json"
printf "  ${DIM}Branch:${NC}  %s\n" "$BRANCH"
printf "  ${DIM}Commit:${NC}  %s (%s)\n" "$COMMIT_SHA" "$COMMIT_DATE"
printf "\n"
