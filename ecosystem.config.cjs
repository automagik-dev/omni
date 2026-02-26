/**
 * PM2 Ecosystem Configuration — Omni v2
 *
 * Services managed:
 *   1. nats      — NATS server with JetStream
 *   2. api       — Omni API (Bun + Hono) with embedded pgserve (PostgreSQL 17)
 *
 * pgserve runs in-process inside the API server (PGSERVE_EMBEDDED=true).
 * No separate PM2 process needed for PostgreSQL.
 *
 * Services are only started if their *_MANAGED=true env var is set.
 * Environment variables must be loaded before PM2 runs:
 *
 *   set -a && . ./.env && set +a && pm2 start ecosystem.config.cjs
 *   Or just: make dev-services
 *
 * Self-healing behaviour:
 *   - Unlimited restarts with exponential backoff (1s → 30s cap)
 *   - Memory leak protection via max_memory_restart
 *   - Log rotation: 10 MB per file, 10 rotated files kept
 *   - Graceful shutdown with SIGINT, 8s kill timeout
 */

const path = require('node:path');

const natsManaged = process.env.NATS_MANAGED === 'true';
const apiManaged = process.env.API_MANAGED === 'true';

// ---------------------------------------------------------------------------
// Shared defaults — production-grade self-healing
// ---------------------------------------------------------------------------
const SHARED = {
  cwd: __dirname,
  autorestart: true,
  watch: false,
  max_restarts: 0, // 0 = unlimited restarts (never give up)
  exp_backoff_restart_delay: 100, // exponential backoff starting at 100ms, caps at 15s
  kill_timeout: 8000, // 8s graceful shutdown before SIGKILL
  listen_timeout: 60000, // 60s — DB readiness probe + migrations can take 30s+
  merge_logs: true,
  // Log rotation (requires pm2-logrotate module — see setup notes below)
  log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
  // Combine stdout+stderr into one file per service for easier tailing
  combine_logs: true,
};

const apps = [];

// ---------------------------------------------------------------------------
// 1. NATS — Event bus with JetStream
// ---------------------------------------------------------------------------
if (natsManaged) {
  const natsServerPath = path.join(__dirname, 'bin', 'nats-server');
  const natsPort = process.env.NATS_PORT || '4222';

  apps.push({
    ...SHARED,
    name: 'omni-v2-nats',
    script: natsServerPath,
    args: ['-js', '-p', natsPort].join(' '),
    env: {
      NODE_ENV: process.env.NODE_ENV || 'development',
    },
    max_memory_restart: '256M',
  });
}

// ---------------------------------------------------------------------------
// 2. API — Omni API server (Bun runtime, embedded pgserve)
//    --watch is only enabled in development; production runs without it
//    to prevent file-change-triggered restarts during deploys.
// ---------------------------------------------------------------------------
if (apiManaged) {
  const isDev = (process.env.NODE_ENV || 'development') !== 'production';
  const apiArgs = isDev ? '--watch packages/api/src/index.ts' : 'packages/api/src/index.ts';

  apps.push({
    ...SHARED,
    name: 'omni-v2-api',
    script: 'bun',
    args: apiArgs,
    env: {
      NODE_ENV: process.env.NODE_ENV || 'development',
      OMNI_PACKAGES_DIR: path.join(__dirname, 'packages'),
    },
    max_memory_restart: '2G',
    // Dependency: wait 1s to let nats bind its port first
    // (PM2 starts apps in array order, this delay helps)
    restart_delay: 1000,
  });
}

module.exports = { apps };
