# Omni v2 — Install Guide (AI-First)

> This document is optimized for LLM agents. Every step is a command. Every command has an expected output. If a step fails, the error section tells you what went wrong.

## Prerequisites

| Dependency | Check | Install |
|-----------|-------|---------|
| Bun | `bun --version` → `1.x` | `curl -fsSL https://bun.sh/install \| bash` |
| PM2 | `pm2 --version` → `5.x+` | `bun add -g pm2` |

Both must be in `$PATH`. If `which bun` or `which pm2` returns nothing, install them first.

## Install

```bash
bun add -g @automagik/omni
```

**Expected:** `installed @automagik/omni@2.YYMMDD.N with binaries: - omni`

**Verify:**
```bash
omni --version
```
→ prints version string like `2.260223.1`

## Setup (Non-Interactive)

```bash
omni install --non-interactive
```

This runs the full wizard with defaults:
- Port: `8882`
- Data dir: `~/.omni/data`
- Database: embedded PGlite at `~/.omni/data/pglite`
- Process manager: PM2
- API key: auto-generated (printed once — capture it)
- NATS: downloaded to `~/.omni/nats-server` if missing

**Expected output pattern:**
```
✓ bun available
✓ port 8882 is free
✓ NATS binary found at ~/.omni/nats-server  (or downloads it)
✔ omni-api started
✔ omni-nats started
✔ Server is healthy
✓ Config written to ~/.omni/config.json

✓ Omni v2.YYMMDD.N is running!
API:    http://localhost:8882
Key:    omni_sk_<hex> <- save this (shown once)
```

**Capture the API key** from stdout. It is shown exactly once.

### Custom Port

```bash
omni install --non-interactive --port 9000
```

### Systemd Instead of PM2

```bash
sudo omni install --non-interactive --systemd
```

Writes `/etc/systemd/system/omni-api.service`. Enable with:
```bash
sudo systemctl enable --now omni-api
```

## Setup (Interactive)

```bash
omni install
```

Prompts for: process manager (PM2/systemd/manual), port, data dir, database URL, API key.

Use this when you need to customize the database URL (external PostgreSQL instead of embedded PGlite).

## Verify

After install, run these checks in order. All must pass.

```bash
# 1. CLI responds
omni --version
# → 2.YYMMDD.N

# 2. Services are running
omni status
# → look for: omni-api online, omni-nats online

# 3. Health endpoint
curl -s http://localhost:8882/api/v2/health | jq '{status, version}'
# → {"status": "healthy", "version": "2.YYMMDD.N"}

# 4. API key works
curl -s -H "x-api-key: <YOUR_KEY>" http://localhost:8882/api/v2/instances | head -c 200
# → JSON array (not 401)
```

## Post-Install: Configure CLI

If you ran `omni install`, the config is already written. Otherwise:

```bash
omni config set apiUrl http://localhost:8882
omni config set apiKey omni_sk_<your_key>
```

Config lives at `~/.omni/config.json`.

## Post-Install: Create a Channel Instance

```bash
# WhatsApp (Baileys — QR-based)
omni instances create --channel whatsapp --name "my-whatsapp"
# → prints QR code to scan

# Telegram
omni instances create --channel telegram --name "my-telegram" --config '{"botToken": "<BOT_TOKEN>"}'

# Discord
omni instances create --channel discord --name "my-discord" --config '{"botToken": "<BOT_TOKEN>"}'

# Slack
omni instances create --channel slack --name "my-slack" --config '{"appToken": "<APP_TOKEN>", "botToken": "<BOT_TOKEN>"}'
```

## Post-Install: Connect an OpenClaw Agent

```bash
omni providers setup openclaw \
  --gateway-url ws://127.0.0.1:18789 \
  --gateway-token <YOUR_GATEWAY_TOKEN> \
  --agent-id <YOUR_AGENT_ID>
```

Expected output:
```
✓ Generated device keypair
✓ Registered device with gateway
✓ Created provider: <name>
✓ Provider is healthy
```

Then assign the provider to a channel instance:
```bash
omni instances update <instance-id> \
  --agent-provider <provider-id> \
  --agent <YOUR_AGENT_ID>
```

Verify the provider is healthy:
```bash
omni providers test <provider-id>
# → Provider is healthy (latency: Nms)
```

## Service Management

```bash
omni start              # Start all (API + NATS)
omni stop               # Stop all
omni restart             # Restart all
omni status              # Health + process table
omni logs --process api  # PM2 logs for API
omni logs --process nats # PM2 logs for NATS
```

Under the hood these run `pm2 start|stop|restart` against processes named `omni-api` and `omni-nats`.

## Update

```bash
omni update
# or manually:
bun add -g @automagik/omni@latest && omni restart
```

## Uninstall

```bash
omni stop
pm2 delete omni-api omni-nats
bun remove -g @automagik/omni
rm -rf ~/.omni
```

## File Layout

```
~/.omni/
├── config.json          # CLI config (apiUrl, apiKey, format)
├── server-config.json   # Server config (port, dataDir, databaseUrl)
├── data/
│   ├── pglite/          # Embedded PostgreSQL data (PGlite)
│   └── media/           # Downloaded media files
└── nats-server          # NATS binary (downloaded by installer)
```

## Troubleshooting

### `omni install` says "Server bundle not found"

The npm package didn't include the server bundle. Fix:
```bash
bun remove -g @automagik/omni
bun add -g @automagik/omni@latest
ls ~/.bun/install/global/node_modules/@automagik/omni/dist/server/index.js
# Must exist. If not, the publish was broken.
```

### Health check fails after install

```bash
pm2 logs omni-api --lines 20 --nostream
```

Common causes:
- **Port conflict** — another process on 8882. Use `--port <other>`.
- **PGlite crash** — check for `PGSERVE` errors in logs. Delete `~/.omni/data/pglite` and restart.
- **Missing bun** — PM2 spawns with `bun` interpreter. Ensure `which bun` works for the PM2 user.

### `omni status` shows "keyValid: no"

The API key in `~/.omni/config.json` doesn't match what the server expects. The server reads its key from `OMNI_API_KEY` env var (set during `omni install`). Check:
```bash
pm2 env omni-api | grep OMNI_API_KEY
cat ~/.omni/config.json | grep apiKey
```
They must match. If not, update the config:
```bash
omni config set apiKey <correct_key>
```

If the key was lost or rotated (e.g. after a redeploy), run:
```bash
omni auth recover
# → generates new key, restarts API, updates ~/.omni/config.json
```

Verify:
```bash
omni status | grep keyValid
# → keyValid: yes
```

### pgserve port conflict (port 8432)

If `omni install` fails with `EADDRINUSE 8432` or PM2 shows `omni-v2-pgserve` crashing:
```bash
pm2 delete omni-v2-pgserve
omni restart
```

The embedded PGlite backend doesn't use port 8432 — a stale `omni-v2-pgserve` process is conflicting. Delete it and restart.

### PM2 not found

```bash
bun add -g pm2
# Verify:
pm2 --version
```

### NATS binary missing

```bash
omni install --non-interactive
# Re-downloads NATS to ~/.omni/nats-server
```

Or manually:
```bash
NATS_VERSION=v2.10.24
curl -L "https://github.com/nats-io/nats-server/releases/download/${NATS_VERSION}/nats-server-${NATS_VERSION}-linux-amd64.tar.gz" | tar xz
mv nats-server-*/nats-server ~/.omni/nats-server
chmod +x ~/.omni/nats-server
```

### OpenClaw provider health check fails after delete/recreate

After deleting and recreating an OpenClaw provider, the API client pool may hold a stale connection. Restart the API to flush it:
```bash
omni restart
omni providers test <new-provider-id>
# → Provider is healthy
```

### OpenClaw error: `operator.write` scope missing

```
Error: gateway rejected message — missing scope: operator.write
```

The device has not been paired with the gateway. Run the setup wizard to generate a keypair and register the device:
```bash
omni providers setup openclaw \
  --gateway-url ws://127.0.0.1:18789 \
  --gateway-token <YOUR_GATEWAY_TOKEN> \
  --agent-id <YOUR_AGENT_ID>
```

This creates a new provider with a device token that has `operator.write` scope. If you already have a provider and want to re-pair only, delete the old one and run setup again.

## One-Liner (Full Setup from Zero)

```bash
curl -fsSL https://bun.sh/install | bash \
  && export PATH="$HOME/.bun/bin:$PATH" \
  && bun add -g pm2 @automagik/omni \
  && omni install --non-interactive
```

Requires: Linux or macOS, x64 or arm64, internet access.
