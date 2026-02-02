# WISH: DX Setup Improvements

> Make Omni v2 easy to install and run on any platform with one command.

**Status:** DRAFT
**Created:** 2026-02-02
**Author:** WISH Agent
**Beads:** omni-6mf

---

## Context

**Current State:**
- PM2 manages only pgserve + NATS (API run separately with `make dev-api`)
- Port is 8881 (needs to change to 8882)
- README shows ecosystem.config.js but file is ecosystem.config.cjs
- NATS setup only documented for Linux
- No cross-platform install script
- CLI bootstrap not implemented

**Problems:**
1. New developers need multiple steps to get running
2. Mac/Windows developers struggle with NATS setup
3. API not managed by PM2 → inconsistent process management
4. Documentation doesn't match reality
5. No "omni install" command for full system setup

**Goal:** `git clone && make setup` works on Linux/Mac/Windows with zero manual steps.

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **DEC-1** | Decision | Default port changes from 8881 → 8882 |
| **DEC-2** | Decision | PM2 manages ALL services (pgserve, NATS, API) |
| **DEC-3** | Decision | Linux is primary, Mac/Windows should work |
| **DEC-4** | Decision | CLI can bootstrap full system (`omni install`) |
| **DEC-5** | Decision | Single `make setup` for complete dev environment |

---

## Scope

### IN SCOPE

- Update default port to 8882
- PM2 ecosystem to include API
- Cross-platform NATS binary download
- Updated README with accurate setup
- `omni install` CLI command (post cli-setup)
- Platform detection scripts
- .env.example improvements

### OUT OF SCOPE

- Docker support (PM2 is our approach)
- Windows WSL2 specific setup (use native where possible)
- IDE configurations

---

## Execution Group A: Port, PM2 & Root Endpoints

**Goal:** Change default port, add API to PM2, and add root-level convenience endpoints.

**Deliverables:**
- [ ] Update `.env.example` - `API_PORT=8882`
- [ ] Update `ecosystem.config.cjs` - Add API app
- [ ] Update `Makefile` - Remove separate `dev-api` target
- [ ] Update all docs referencing port 8881
- [ ] Add root-level convenience endpoints (see below)

**Root-Level Endpoints:**

```
GET /           → Welcome page with links to docs, health, OpenAPI
GET /health     → Redirect to /api/v2/health (or inline health check)
GET /docs       → Redirect to /api/v2/docs (Swagger UI)
GET /openapi.json → Redirect to /api/v2/openapi.json
```

**Root Response Example:**

```json
// GET /
{
  "name": "Omni v2",
  "version": "2.0.0",
  "docs": "/docs",
  "openapi": "/openapi.json",
  "health": "/health",
  "api": "/api/v2"
}
```

This makes discovery easy - hit the root and see where everything is.

**PM2 Ecosystem Update:**

```javascript
// ecosystem.config.cjs
const apps = [];

// PostgreSQL (optional, for local dev)
if (pgserveManaged) {
  apps.push({
    name: 'omni-pgserve',
    script: 'bunx',
    args: 'pgserve --port 8432 --data ./.pgserve-data --no-cluster',
    // ...
  });
}

// NATS (optional, for local dev)
if (natsManaged) {
  apps.push({
    name: 'omni-nats',
    script: './bin/nats-server',
    args: '-js -p 4222',
    // ...
  });
}

// API (always)
apps.push({
  name: 'omni-api',
  script: 'npx',
  args: 'tsx watch packages/api/src/index.ts',
  env: {
    NODE_ENV: 'development',
    API_PORT: process.env.API_PORT || '8882',
    OMNI_PACKAGES_DIR: path.join(__dirname, 'packages'),
  },
  // ...
});
```

**Acceptance Criteria:**
- [ ] `make dev` starts ALL services via PM2
- [ ] API runs on port 8882
- [ ] `pm2 logs` shows all services
- [ ] `pm2 restart omni-api` works
- [ ] `curl localhost:8882/` returns JSON with links
- [ ] `curl localhost:8882/health` returns health status
- [ ] `curl localhost:8882/docs` opens Swagger UI
- [ ] `curl localhost:8882/openapi.json` returns OpenAPI spec

---

## Execution Group B: Cross-Platform Setup

**Goal:** NATS and dependencies work on Linux, Mac, Windows.

**Deliverables:**
- [ ] `scripts/setup-nats.sh` - Cross-platform NATS download
- [ ] Update `Makefile` ensure-nats target
- [ ] Add platform detection

**Setup Script:**

```bash
#!/usr/bin/env bash
# scripts/setup-nats.sh

set -e

NATS_VERSION="v2.10.22"
BIN_DIR="./bin"
mkdir -p "$BIN_DIR"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  linux)
    case "$ARCH" in
      x86_64) PLATFORM="linux-amd64" ;;
      aarch64) PLATFORM="linux-arm64" ;;
      *) echo "Unsupported Linux arch: $ARCH"; exit 1 ;;
    esac
    ;;
  darwin)
    case "$ARCH" in
      x86_64) PLATFORM="darwin-amd64" ;;
      arm64) PLATFORM="darwin-arm64" ;;
      *) echo "Unsupported Mac arch: $ARCH"; exit 1 ;;
    esac
    ;;
  mingw*|msys*|cygwin*)
    PLATFORM="windows-amd64"
    ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

URL="https://github.com/nats-io/nats-server/releases/download/${NATS_VERSION}/nats-server-${NATS_VERSION}-${PLATFORM}.tar.gz"

echo "Downloading NATS server for $PLATFORM..."
curl -sL "$URL" | tar xz -C "$BIN_DIR" --strip-components=1
echo "✓ NATS server installed at $BIN_DIR/nats-server"
```

**Acceptance Criteria:**
- [ ] `make ensure-nats` works on Linux x64/arm64
- [ ] `make ensure-nats` works on Mac Intel/Apple Silicon
- [ ] `make ensure-nats` works on Windows (Git Bash/WSL)

---

## Execution Group C: README & Docs

**Goal:** README accurately reflects setup process.

**Deliverables:**
- [ ] Update README.md Quick Start section
- [ ] Update README.md port references (8881 → 8882)
- [ ] Fix ecosystem.config.js → ecosystem.config.cjs reference
- [ ] Add platform-specific notes
- [ ] Add troubleshooting section

**Quick Start (Updated):**

```markdown
## Quick Start

```bash
# Clone
git clone https://github.com/namastexlabs/omni-v2.git
cd omni-v2

# One-command setup (installs deps, downloads NATS, starts services)
make setup

# That's it! API running at http://localhost:8882
```

### Platform Notes

**Linux (Ubuntu/Debian):**
```bash
# Prerequisites
sudo apt install -y curl git
curl -fsSL https://bun.sh/install | bash
npm install -g pm2

make setup
```

**Mac:**
```bash
# Prerequisites
brew install bun pm2

make setup
```

**Windows (Git Bash or WSL2):**
```bash
# In Git Bash or WSL2
# Install Bun: https://bun.sh
npm install -g pm2

make setup
```
```

---

## Execution Group D: CLI Bootstrap

**Goal:** `omni install` can set up the entire system.

**Depends On:** `cli-setup` wish

**Deliverables:**
- [ ] `omni install` command in CLI
- [ ] Detects missing dependencies
- [ ] Downloads NATS if missing
- [ ] Creates .env from template
- [ ] Initializes database
- [ ] Starts services via PM2

**CLI Command:**

```bash
# Full system setup
omni install

# Check what would be done
omni install --dry-run

# Install specific components
omni install --component nats
omni install --component db
```

**Acceptance Criteria:**
- [ ] Fresh machine + `bun` + `pm2` → `omni install` → working system
- [ ] Idempotent (safe to run multiple times)
- [ ] Clear error messages for missing prerequisites

---

## Execution Group E: .env Improvements

**Goal:** Better documented, more complete .env.example.

**Deliverables:**
- [ ] Update `.env.example` with all options
- [ ] Group by category with comments
- [ ] Add sensible defaults

**.env.example (Updated):**

```bash
# =============================================================================
# Omni v2 Environment Configuration
# =============================================================================

# -----------------------------------------------------------------------------
# API Server
# -----------------------------------------------------------------------------
API_PORT=8882
API_HOST=0.0.0.0
NODE_ENV=development
LOG_LEVEL=debug

# -----------------------------------------------------------------------------
# Database (PostgreSQL)
# -----------------------------------------------------------------------------
DATABASE_URL=postgresql://postgres:postgres@localhost:8432/omni

# PM2-managed local PostgreSQL (set to false if using external DB)
PGSERVE_MANAGED=true
PGSERVE_PORT=8432
PGSERVE_DATA=./.pgserve-data

# -----------------------------------------------------------------------------
# Event Bus (NATS)
# -----------------------------------------------------------------------------
NATS_URL=nats://localhost:4222

# PM2-managed local NATS (set to false if using external NATS)
NATS_MANAGED=true
NATS_PORT=4222

# -----------------------------------------------------------------------------
# Media Storage
# -----------------------------------------------------------------------------
MEDIA_STORAGE_TYPE=local
MEDIA_STORAGE_PATH=./data/media

# S3-compatible storage (when MEDIA_STORAGE_TYPE=s3)
# S3_BUCKET=
# S3_REGION=auto
# S3_ENDPOINT=
# S3_ACCESS_KEY_ID=
# S3_SECRET_ACCESS_KEY=
# S3_PUBLIC_URL=

# -----------------------------------------------------------------------------
# API Keys (optional, for agent providers / media processing)
# -----------------------------------------------------------------------------
# OPENAI_API_KEY=
# ANTHROPIC_API_KEY=
# GROQ_API_KEY=
# GEMINI_API_KEY=

# -----------------------------------------------------------------------------
# Security
# -----------------------------------------------------------------------------
# API_KEY=omni_sk_... (auto-generated on first run if not set)
```

---

## Technical Notes

### Why Port 8882?

- 8880: Often used by other services
- 8881: Current (changing to avoid conflicts with v1)
- 8882: New default for v2
- Easy to remember: 88 + v2 = 8882

### Makefile Simplification

Current:
```bash
make dev-services  # Start pgserve + NATS
make dev-api       # Start API separately
```

After:
```bash
make dev           # Starts EVERYTHING via PM2
```

### PM2 Benefits

- Process management (restart on crash)
- Log aggregation (`pm2 logs`)
- Monitoring (`pm2 monit`)
- Easy restart (`pm2 restart omni-api`)
- Environment isolation

---

## Dependencies

- PM2 installed globally (`npm install -g pm2`)
- Bun runtime

## Depends On

- `cli-setup` (for Group D: CLI bootstrap)

## Enables

- Easy onboarding for new developers
- Consistent dev environment across team
- Production-like local setup
