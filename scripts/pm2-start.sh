#!/usr/bin/env bash
# =============================================================================
# PM2 start script — used by systemd and manual restarts
#
# What this does:
#   1. Loads .env from the omni project directory
#   2. Kills any orphan processes holding the NATS port
#   3. Deletes stale PM2 processes (avoids "waiting restart" limbo)
#   4. Starts fresh from ecosystem.config.cjs
#   5. Saves the PM2 dump for resurrect on reboot
#
# Note: pgserve runs embedded inside the API process (PGSERVE_EMBEDDED=true)
# so there is no separate pgserve PM2 process to manage.
#
# Usage:
#   ./scripts/pm2-start.sh          # full restart
#   ./scripts/pm2-start.sh --save   # also save dump after start (default)
#   ./scripts/pm2-start.sh --no-save # skip saving dump
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"

# Load environment
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  echo "[pm2-start] Loaded env from $ENV_FILE"
else
  echo "[pm2-start] WARNING: $ENV_FILE not found, using existing env"
fi

cd "$PROJECT_DIR"

# ---------------------------------------------------------------------------
# Kill orphan processes holding our ports
# ---------------------------------------------------------------------------
kill_port_holder() {
  local port=$1
  local name=$2
  local pids
  pids=$(lsof -ti :"$port" 2>/dev/null) || true
  if [ -n "$pids" ]; then
    echo "[pm2-start] Killing processes holding port $port ($name): $pids"
    echo "$pids" | xargs kill 2>/dev/null || true
    sleep 2
    # Force kill any survivors
    local remaining
    remaining=$(lsof -ti :"$port" 2>/dev/null) || true
    if [ -n "$remaining" ]; then
      echo "[pm2-start] Force-killing remaining on port $port: $remaining"
      echo "$remaining" | xargs kill -9 2>/dev/null || true
      sleep 1
    fi
  fi
}

NATS_PORT="${NATS_PORT:-4222}"

kill_port_holder "$NATS_PORT" "nats-server"

# ---------------------------------------------------------------------------
# Clean slate: delete all omni-v2 processes from PM2
# ---------------------------------------------------------------------------
echo "[pm2-start] Cleaning stale PM2 processes..."
pm2 delete omni-v2-nats 2>/dev/null || true
pm2 delete omni-v2-api 2>/dev/null || true

# ---------------------------------------------------------------------------
# Start fresh from ecosystem config
# ---------------------------------------------------------------------------
echo "[pm2-start] Starting services from ecosystem.config.cjs..."
pm2 start ecosystem.config.cjs

# Wait a moment for services to bind
sleep 3

# ---------------------------------------------------------------------------
# Save dump for systemd resurrect (unless --no-save)
# ---------------------------------------------------------------------------
SAVE_DUMP=true
for arg in "$@"; do
  case "$arg" in
    --no-save) SAVE_DUMP=false ;;
  esac
done

if [ "$SAVE_DUMP" = true ]; then
  pm2 save
  echo "[pm2-start] PM2 dump saved"
fi

# ---------------------------------------------------------------------------
# Status report
# ---------------------------------------------------------------------------
echo ""
echo "[pm2-start] Service status:"
pm2 list
