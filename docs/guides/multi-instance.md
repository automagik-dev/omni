# Multi-Instance Deployment Guide

Run multiple fully isolated Omni instances on the same machine. Each instance gets its own database, event bus, API port, and state directory.

## When to Use Multi-Instance

Use separate Omni instances when you need **full isolation** between environments:

- Separate production and staging with different databases
- Run multiple WhatsApp numbers with completely independent state
- Isolate client deployments on shared infrastructure
- Test migrations or upgrades without affecting production

**If you only need per-user config differences on the same number** (different agents, different debounce settings), consider route-level overrides instead — see `omni routes create --help` and the [Agent Routing Reference](../../.agents/skills/omni-orchestrator/references/AGENT_ROUTING.md).

## Architecture

Each instance runs its own process tree managed by PM2:

```
Machine
├── Instance A (production)
│   ├── NATS server (port 4222)
│   ├── API server (port 8882)
│   └── pgserve (port 8432)
│
└── Instance B (staging)
    ├── NATS server (port 4223)
    ├── API server (port 8883)
    └── pgserve (port 8433)
```

Isolation is achieved by giving each instance a different `HOME` directory, which separates:
- PM2 process namespace (`~/.pm2/`)
- Omni data directory (`~/.omni/`)
- pgserve data directory (configured via `PGSERVE_DATA`)

## PM2 Ecosystem Template

Create one `ecosystem.config.cjs` per instance, or use a single file with namespaced process names. Below is a template for two isolated instances.

### Per-Instance `.env` Files

**`/opt/omni/production/.env`**:

```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:8432/omni
PGSERVE_EMBEDDED=true
PGSERVE_PORT=8432
PGSERVE_DATA=/opt/omni/production/.pgserve-data

# NATS
NATS_URL=nats://localhost:4222
NATS_MANAGED=true
NATS_PORT=4222

# API
API_PORT=8882
API_HOST=0.0.0.0
API_MANAGED=true
NODE_ENV=production
```

**`/opt/omni/staging/.env`**:

```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:8433/omni
PGSERVE_EMBEDDED=true
PGSERVE_PORT=8433
PGSERVE_DATA=/opt/omni/staging/.pgserve-data

# NATS
NATS_URL=nats://localhost:4223
NATS_MANAGED=true
NATS_PORT=4223

# API
API_PORT=8883
API_HOST=0.0.0.0
API_MANAGED=true
NODE_ENV=staging
```

### PM2 Ecosystem File

**`/opt/omni/ecosystem.config.cjs`**:

```javascript
const path = require('node:path');

const SHARED = {
  autorestart: true,
  watch: false,
  max_restarts: 0,
  exp_backoff_restart_delay: 100,
  kill_timeout: 8000,
  listen_timeout: 60000,
  merge_logs: true,
  log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
  combine_logs: true,
};

module.exports = {
  apps: [
    // ── Production ──────────────────────────────────────────
    {
      ...SHARED,
      name: 'omni-prod-nats',
      cwd: '/opt/omni/production',
      script: '/opt/omni/production/bin/nats-server',
      args: '-js -p 4222',
      env: { HOME: '/opt/omni/production' },
      max_memory_restart: '256M',
    },
    {
      ...SHARED,
      name: 'omni-prod-api',
      cwd: '/opt/omni/production',
      script: 'bun',
      args: 'packages/api/src/index.ts',
      env: {
        HOME: '/opt/omni/production',
        NODE_ENV: 'production',
        OMNI_PACKAGES_DIR: '/opt/omni/production/packages',
      },
      env_file: '/opt/omni/production/.env',
      max_memory_restart: '2G',
      restart_delay: 1000,
    },

    // ── Staging ─────────────────────────────────────────────
    {
      ...SHARED,
      name: 'omni-staging-nats',
      cwd: '/opt/omni/staging',
      script: '/opt/omni/staging/bin/nats-server',
      args: '-js -p 4223',
      env: { HOME: '/opt/omni/staging' },
      max_memory_restart: '256M',
    },
    {
      ...SHARED,
      name: 'omni-staging-api',
      cwd: '/opt/omni/staging',
      script: 'bun',
      args: 'packages/api/src/index.ts',
      env: {
        HOME: '/opt/omni/staging',
        NODE_ENV: 'staging',
        OMNI_PACKAGES_DIR: '/opt/omni/staging/packages',
      },
      env_file: '/opt/omni/staging/.env',
      max_memory_restart: '2G',
      restart_delay: 1000,
    },
  ],
};
```

## Required Setup

### 1. Clone Omni Per Instance

Each instance needs its own copy of the Omni codebase (or at minimum, the `bin/` and `packages/` directories):

```bash
# Production
git clone <omni-repo> /opt/omni/production
cd /opt/omni/production && bun install

# Staging
git clone <omni-repo> /opt/omni/staging
cd /opt/omni/staging && bun install
```

### 2. Install NATS Binary Per Instance

Each HOME directory needs its own NATS binary because the ecosystem config references it by path:

```bash
cd /opt/omni/production && ./scripts/ensure-nats.sh
cd /opt/omni/staging && ./scripts/ensure-nats.sh
```

### 3. Create `.env` Files

Copy `.env.example` and adjust ports for each instance (see the env files above):

```bash
cp .env.example /opt/omni/production/.env
cp .env.example /opt/omni/staging/.env
# Edit each with unique PGSERVE_PORT, NATS_PORT, API_PORT
```

### 4. Start Services

```bash
# Load env and start all instances
pm2 start /opt/omni/ecosystem.config.cjs

# Or start individually
set -a && . /opt/omni/production/.env && set +a
pm2 start /opt/omni/ecosystem.config.cjs --only omni-prod-nats,omni-prod-api

# Save for reboot persistence
pm2 save
```

## CLI Usage Per Instance

The `omni` CLI defaults to `http://localhost:8882`. When managing a non-default instance, specify the API URL and key:

```bash
# Talk to the staging instance
omni instances list --api-url http://localhost:8883

# Set a per-instance API key for auth
omni instances list --api-url http://localhost:8883 --api-key <staging-key>

# Tip: use shell aliases for convenience
alias omni-prod='omni --api-url http://localhost:8882 --api-key $PROD_KEY'
alias omni-staging='omni --api-url http://localhost:8883 --api-key $STAGING_KEY'

# Then use naturally
omni-staging instances list
omni-prod routes list --instance <id>
```

## Environment Variable Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:8432/omni` |
| `PGSERVE_EMBEDDED` | Run PostgreSQL embedded in API process | `true` |
| `PGSERVE_PORT` | Embedded PostgreSQL port | `8432` |
| `PGSERVE_DATA` | pgserve data directory | `./.pgserve-data` |
| `NATS_URL` | NATS server connection URL | `nats://localhost:4222` |
| `NATS_MANAGED` | Let PM2 manage NATS server | `true` |
| `NATS_PORT` | NATS server listen port | `4222` |
| `API_PORT` | Omni API listen port | `8882` |
| `API_HOST` | Omni API bind address | `0.0.0.0` |
| `API_MANAGED` | Let PM2 manage API server | `true` |
| `NODE_ENV` | Environment name | `development` |
| `LOG_LEVEL` | Log verbosity | `debug` |

## Known Limitations

### Multi-Device Routing Unpredictability

WhatsApp's multi-device architecture means messages may arrive on different linked devices with slightly different metadata. When the same WhatsApp number is connected through multiple Omni instances (not recommended), message routing can become unpredictable because:

- WhatsApp may deliver the same message to multiple linked sessions
- Session state (read receipts, typing indicators) may not sync between instances
- Reconnection behavior after network issues varies per device

**Recommendation:** Use one Omni instance per WhatsApp number. For different agent behavior per user or chat, use route-level overrides rather than separate instances.

### Port Conflicts

Each instance must use unique ports for `PGSERVE_PORT`, `NATS_PORT`, and `API_PORT`. Port conflicts will cause startup failures. Verify with:

```bash
# Check for port conflicts before starting
lsof -i :8432 -i :8433 -i :4222 -i :4223 -i :8882 -i :8883
```

### Disk Space

Each instance maintains its own PostgreSQL data directory and media downloads. Plan storage accordingly — media files accumulate in `~/.omni/data/media/`.

## Monitoring

```bash
# PM2 status for all instances
pm2 list

# Logs for a specific service
pm2 logs omni-prod-api --lines 100
pm2 logs omni-staging-api --lines 100

# Restart a specific instance
pm2 restart omni-staging-api

# Check instance health via CLI
omni-prod instances status <id>
omni-staging instances status <id>
```
