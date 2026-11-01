#!/bin/bash
#
# Check (and optionally install) required and optional dependencies
#
# Usage: ./scripts/check-dependencies.sh [--install] [--strict]
#        --install: Auto-install missing dependencies (requires sudo for system packages)
#        --strict:  Exit with error if any dependency is missing
#

# Set OMNI_ALLOW_BUN_DOWNGRADE=1 only to consent to replacing a newer Bun.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTO_INSTALL=false
STRICT=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --install) AUTO_INSTALL=true; shift ;;
    --strict) STRICT=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

MISSING_REQUIRED=0
MISSING_OPTIONAL=0

echo "=================================================="
echo "Checking Dependencies for Omni v2"
echo "=================================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

check_and_install_command() {
  local cmd=$1
  local required=${2:-true}
  local description=$3
  local install_pkg=$4  # Package name (may differ from command name)

  if command -v "$cmd" >/dev/null 2>&1; then
    local version=$($cmd --version 2>&1 | head -1)
    printf "${GREEN}✓${NC} %-15s ${version}\n" "$cmd"
    return 0
  else
    if [ "$required" = "true" ]; then
      printf "${RED}✗${NC} %-15s REQUIRED - Not installed\n" "$cmd"
      MISSING_REQUIRED=$((MISSING_REQUIRED + 1))

      if [ "$AUTO_INSTALL" = "true" ]; then
        install_dependency "$cmd" "$install_pkg"
      fi
    else
      printf "${YELLOW}⚠${NC} %-15s OPTIONAL - Not installed\n" "$cmd"
      MISSING_OPTIONAL=$((MISSING_OPTIONAL + 1))
    fi
    return 1
  fi
}

install_dependency() {
  local cmd=$1
  local pkg=${2:-$1}

  echo "  Installing $pkg..."

  if [ "$(uname)" = "Darwin" ]; then
    # macOS with Homebrew
    if command -v brew >/dev/null 2>&1; then
      brew install "$pkg" 2>/dev/null && echo "  ✓ $pkg installed" && return 0
    fi
  elif [ -f /etc/debian_version ]; then
    # Debian/Ubuntu
    sudo apt-get update >/dev/null 2>&1
    sudo apt-get install -y "$pkg" >/dev/null 2>&1 && echo "  ✓ $pkg installed" && return 0
  elif [ -f /etc/fedora-release ]; then
    # Fedora
    sudo dnf install -y "$pkg" >/dev/null 2>&1 && echo "  ✓ $pkg installed" && return 0
  fi

  echo "  ⚠ Could not auto-install $pkg. Please install manually."
  return 1
}

# These entrypoints also run directly from curl, so keep the replacement guard standalone.
# An explicit opt-in is required before replacing a newer machine-wide Bun.
prepare_bun_install() {
  local candidate found previous=""
  for candidate in "$(command -v bun || true)" "$HOME/.bun/bin/bun"; do
    [[ -x "$candidate" && "$candidate" != "$previous" ]] || continue
    previous="$candidate"
    found="$("$candidate" --version)" || { echo "Cannot read Bun version at $candidate; nothing replaced."; return 1; }
    printf 'Found Bun %s at %s; installation will replace %s with Bun 1.4.4.\n' "$found" "$candidate" "$HOME/.bun/bin/bun"
    if [[ ! "$found" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
      echo "Cannot compare Bun version '$found'; nothing replaced."
      return 1
    fi
    if awk -v found="$found" 'BEGIN {
      split(found, v, "."); split("1.4.4", required, ".");
      for (i = 1; i <= 3; i++) {
        if (v[i]+0 > required[i]+0) exit 0;
        if (v[i]+0 < required[i]+0) exit 1;
      }
      exit 1;
    }' && [[ "${OMNI_ALLOW_BUN_DOWNGRADE:-}" != "1" ]]; then
      echo "Refusing to downgrade Bun $found. Re-run with OMNI_ALLOW_BUN_DOWNGRADE=1 to consent; nothing replaced."
      return 1
    fi
  done
}

echo "${BLUE}Required Dependencies:${NC}"
check_and_install_command "make" "true" "Build system" "make"
check_and_install_command "curl" "true" "Download tool (for NATS setup)" "curl"

# Special handling for bun (requires curl-based install)
if command -v bun >/dev/null 2>&1 && [ "$(bun --version)" = "1.4.4" ]; then
  version=$(bun --version 2>&1)
  printf "${GREEN}✓${NC} %-15s bun $version\n" "bun"
else
  printf "${RED}✗${NC} %-15s REQUIRED - Bun 1.4.4 is not on PATH\n" "bun"
  MISSING_REQUIRED=$((MISSING_REQUIRED + 1))
  if [ "$AUTO_INSTALL" = "true" ]; then
    prepare_bun_install || exit 1
    echo "  Installing bun 1.4.4..."
    curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.4" 2>/dev/null && echo "  ✓ bun installed" || echo "  ⚠ Could not auto-install bun. Please install from https://bun.sh"
  fi
fi

# Special handling for pm2 (requires npm/bun)
if command -v pm2 >/dev/null 2>&1; then
  version=$(pm2 -v 2>&1 | head -1)
  printf "${GREEN}✓${NC} %-15s $version\n" "pm2"
else
  printf "${RED}✗${NC} %-15s REQUIRED - Not installed\n" "pm2"
  MISSING_REQUIRED=$((MISSING_REQUIRED + 1))
  if [ "$AUTO_INSTALL" = "true" ]; then
    echo "  Installing pm2..."
    if command -v npm >/dev/null 2>&1; then
      npm install -g pm2 2>/dev/null && echo "  ✓ pm2 installed" || echo "  ⚠ Could not install pm2 via npm"
    elif command -v bun >/dev/null 2>&1; then
      bun add -g pm2 2>/dev/null && echo "  ✓ pm2 installed" || echo "  ⚠ Could not install pm2 via bun"
    fi
  fi
fi

echo ""
echo "${BLUE}Database (pgserve):${NC}"
if command -v psql >/dev/null 2>&1; then
  version=$(psql --version 2>&1)
  printf "${GREEN}✓${NC} %-15s $version\n" "PostgreSQL"
else
  printf "${YELLOW}⚠${NC} %-15s OPTIONAL - PostgreSQL client not installed\n" "PostgreSQL"
  MISSING_OPTIONAL=$((MISSING_OPTIONAL + 1))
  if [ "$AUTO_INSTALL" = "true" ]; then
    echo "  Installing PostgreSQL client..."
    check_and_install_command "psql" "false" "PostgreSQL client" "postgresql-client"
  fi
fi

echo ""
echo "${BLUE}Optional Dependencies:${NC}"
check_and_install_command "ffmpeg" "false" "Media processing (for WhatsApp voice notes)" "ffmpeg"
check_and_install_command "node" "false" "Node.js (for tsx dev mode if needed)" "nodejs"
check_and_install_command "docker" "false" "Docker (for containerized deployment)" "docker.io"

echo ""
echo "=================================================="

if [ $MISSING_REQUIRED -gt 0 ]; then
  echo ""
  printf "${RED}Missing $MISSING_REQUIRED required dependency(ies)${NC}\n"
  echo ""
  if [ "$AUTO_INSTALL" = "false" ]; then
    echo "To auto-install missing dependencies, run:"
    echo "  ./scripts/check-dependencies.sh --install"
    echo ""
    echo "Manual installation guide:"
    echo ""
    echo "  Ubuntu/Debian:"
    echo "    sudo apt-get install make curl ffmpeg postgresql-client"
    echo "    curl -fsSL https://bun.sh/install | bash -s bun-v1.4.4"
    echo "    npm install -g pm2  (or: bun add -g pm2)"
    echo ""
    echo "  macOS (requires Homebrew):"
    echo "    brew install make curl ffmpeg postgresql"
    echo "    curl -fsSL https://bun.sh/install | bash -s bun-v1.4.4"
    echo "    npm install -g pm2  (or: bun add -g pm2)"
    echo ""
    echo "  Windows (WSL2 recommended):"
    echo "    sudo apt-get install make curl ffmpeg postgresql-client"
    echo "    curl -fsSL https://bun.sh/install | bash -s bun-v1.4.4"
    echo "    npm install -g pm2  (or: bun add -g pm2)"
    echo ""
  fi

  if [ "$STRICT" = "true" ]; then
    exit 1
  fi
else
  printf "${GREEN}All required dependencies are installed!${NC}\n"
fi

if [ $MISSING_OPTIONAL -gt 0 ]; then
  printf "\n${YELLOW}Missing $MISSING_OPTIONAL optional dependency(ies)${NC}\n"
  echo "These are not required for basic functionality but provide:"
  echo "  - PostgreSQL client: Direct database access and administration"
  echo "    (Note: PostgreSQL server is managed by pgserve/PM2 in dev mode)"
  echo "  - ffmpeg: WhatsApp voice note conversion"
  echo "  - node: Alternative to bun (not recommended)"
  echo "  - docker: Containerized deployments"
fi

echo ""
echo "✓ Dependency check complete!"
echo ""
