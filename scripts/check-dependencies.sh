#!/bin/bash
#
# Check for required and optional dependencies
#
# Usage: ./scripts/check-dependencies.sh [--strict]
#        --strict: Exit with error if any dependency is missing
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STRICT="${1:-}"
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

check_command() {
  local cmd=$1
  local required=${2:-true}
  local description=$3

  if command -v "$cmd" >/dev/null 2>&1; then
    local version=$($cmd --version 2>&1 | head -1)
    printf "${GREEN}✓${NC} %-15s ${version}\n" "$cmd"
    return 0
  else
    if [ "$required" = "true" ]; then
      printf "${RED}✗${NC} %-15s REQUIRED - Not installed\n" "$cmd"
      MISSING_REQUIRED=$((MISSING_REQUIRED + 1))
    else
      printf "${YELLOW}⚠${NC} %-15s OPTIONAL - Not installed\n" "$cmd"
      MISSING_OPTIONAL=$((MISSING_OPTIONAL + 1))
    fi
    return 1
  fi
}

echo "${BLUE}Required Dependencies:${NC}"
check_command "make" "true" "Build system"
check_command "bun" "true" "JavaScript runtime and package manager"
check_command "pm2" "true" "Process manager"
check_command "curl" "true" "Download tool (for NATS setup)"

echo ""
echo "${BLUE}Optional Dependencies:${NC}"
check_command "ffmpeg" "false" "Media processing (for WhatsApp voice notes)"
check_command "node" "false" "Node.js (for tsx dev mode if needed)"
check_command "psql" "false" "PostgreSQL client (for manual DB access)"
check_command "docker" "false" "Docker (for containerized deployment)"

echo ""
echo "=================================================="

if [ $MISSING_REQUIRED -gt 0 ]; then
  echo ""
  printf "${RED}Missing $MISSING_REQUIRED required dependency(ies)${NC}\n"
  echo ""
  echo "Installation guide:"
  echo ""
  echo "  Ubuntu/Debian:"
  echo "    sudo apt-get install make curl ffmpeg postgresql-client"
  echo "    curl -fsSL https://bun.sh/install | bash"
  echo "    npm install -g pm2"
  echo ""
  echo "  macOS:"
  echo "    brew install make curl ffmpeg postgresql"
  echo "    curl -fsSL https://bun.sh/install | bash"
  echo "    npm install -g pm2"
  echo ""
  echo "  Windows (WSL2 recommended):"
  echo "    sudo apt-get install make curl ffmpeg postgresql-client"
  echo "    curl -fsSL https://bun.sh/install | bash"
  echo "    npm install -g pm2"
  echo ""

  if [ "$STRICT" = "--strict" ]; then
    exit 1
  fi
else
  printf "${GREEN}All required dependencies are installed!${NC}\n"
fi

if [ $MISSING_OPTIONAL -gt 0 ]; then
  printf "\n${YELLOW}Missing $MISSING_OPTIONAL optional dependency(ies)${NC}\n"
  echo "These are not required for basic functionality but provide:"
  echo "  - ffmpeg: WhatsApp voice note conversion"
  echo "  - node: Alternative to bun (not recommended)"
  echo "  - psql: Direct database access"
  echo "  - docker: Containerized deployments"
fi

echo ""
echo "✓ Dependency check complete!"
echo ""
