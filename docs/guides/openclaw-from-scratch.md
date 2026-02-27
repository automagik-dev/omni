# Omni + OpenClaw — From Scratch to Running Agent

> Zero to a working AI agent on Telegram/Discord/Slack/WhatsApp.
> Every step is a command. Every command has expected output.

---

## Architecture

```
User (Telegram/Discord/Slack/WhatsApp)
  ↓ message
Omni API (port 8882)
  ↓ event dispatch via WebSocket
OpenClaw Gateway (port 18789)
  ↓ agent session
Your Agent (e.g. "khal")
  ↓ response
OpenClaw Gateway
  ↓ chat.send
Omni API → Channel → User
```

Omni handles all channel connections (bots, QR codes, tokens). OpenClaw handles the AI agent. They talk over WebSocket.

---

## Prerequisites

| Dependency | Check | Install |
|-----------|-------|---------|
| Bun | `bun --version` → `1.x` | `curl -fsSL https://bun.sh/install \| bash` |
| PM2 | `pm2 --version` → `5.x+` | `bun add -g pm2` |
| OpenClaw Gateway | `openclaw gateway status` | See OpenClaw docs |

## Step 1 — Install Omni CLI

```bash
bun add -g @automagik/omni
```

Verify:
```bash
omni --version
# → 2.260223.7 (or later)
```

## Step 2 — Run the Installer

```bash
omni install --non-interactive
```

This bootstraps everything with sane defaults:
- **Port:** 8882
- **Database:** Embedded PostgreSQL via pgserve (no external setup needed)
- **Event bus:** NATS JetStream (binary auto-downloaded)
- **Process manager:** PM2
- **API key:** Auto-generated (printed once — save it)

Expected output:
```
✓ bun available
✓ port 8882 is free
✓ NATS binary found at ~/.omni/nats-server
✔ omni-api started
✔ omni-nats started
✔ Server is healthy
✓ Config written to ~/.omni/config.json

✓ Omni v2.260223.7 is running!
API:    http://localhost:8882
Key:    omni_sk_<hex>       ← SAVE THIS
```

**Capture the API key.** It is shown exactly once.

Custom port:
```bash
omni install --non-interactive --port 9000
```

## Step 3 — Verify Installation

```bash
# Services running
omni status
# → omni-api online, omni-nats online

# Health endpoint
curl -s http://localhost:8882/api/v2/health | jq '{status, version}'
# → {"status": "healthy", "version": "2.260223.7"}

# API key works
curl -s -H "x-api-key: <YOUR_KEY>" http://localhost:8882/api/v2/instances | head -c 100
# → JSON (not 401)
```

All three must pass before continuing.

## Step 4 — Create an OpenClaw Provider

This connects Omni to your OpenClaw gateway.

```bash
omni providers setup openclaw \
  --gateway-url ws://127.0.0.1:18789 \
  --gateway-token <YOUR_GATEWAY_TOKEN> \
  --agent-id <YOUR_AGENT_ID>
```

Replace:
- `<YOUR_GATEWAY_TOKEN>` — the shared token from your OpenClaw gateway config (`gateway.auth.token`)
- `<YOUR_AGENT_ID>` — the agent name in OpenClaw (e.g. `khal`, `eva`)

Expected output:
```
✔ Device keypair generated
✔ Device paired with gateway (operator.read + operator.write)
✔ Provider created: <agent>-openclaw
✔ Provider is healthy (latency: 18ms)

Provider ID: f096eb2e-...
```

Save the **Provider ID** — you need it for the next step.

> **What this does:** Generates an Ed25519 keypair, registers it with the gateway for `operator.write` scope (required to send messages back to users), and creates a provider record in Omni's database.

## Step 5 — Create Channel Instances

Create one or more channel instances and link them to your provider.

### Telegram

```bash
omni instances create \
  --channel telegram \
  --name "my-telegram" \
  --telegram-token "<BOT_TOKEN>" \
  --agent-provider <PROVIDER_ID> \
  --agent <YOUR_AGENT_ID>
```

Get your bot token from [@BotFather](https://t.me/BotFather).

### Discord

```bash
omni instances create \
  --channel discord \
  --name "my-discord" \
  --discord-token "<BOT_TOKEN>" \
  --agent-provider <PROVIDER_ID> \
  --agent <YOUR_AGENT_ID>
```

Get your bot token from the [Discord Developer Portal](https://discord.com/developers/applications). Enable the **Message Content** intent.

### Slack

```bash
omni instances create \
  --channel slack \
  --name "my-slack" \
  --slack-app-token "<APP_TOKEN>" \
  --slack-bot-token "<BOT_TOKEN>" \
  --agent-provider <PROVIDER_ID> \
  --agent <YOUR_AGENT_ID>
```

Requires a Slack app with Socket Mode enabled. Get tokens from [Slack API](https://api.slack.com/apps).

### WhatsApp

```bash
omni instances create \
  --channel whatsapp-baileys \
  --name "my-whatsapp" \
  --agent-provider <PROVIDER_ID> \
  --agent <YOUR_AGENT_ID>
```

Then scan the QR code:
```bash
omni instances qr <INSTANCE_ID>
```

Or use phone number pairing:
```bash
omni instances pair <INSTANCE_ID> --phone "+1234567890"
```

## Step 6 — Verify End-to-End

```bash
# List instances — all should show status: connected
omni instances list

# Check provider health
omni providers test <PROVIDER_ID>
# → Provider is healthy (latency: Nms)

# Send a test message to your bot on the channel
# Check Omni logs for the event flow:
pm2 logs omni-api --lines 30 --nostream
# → Should show: message.received → agent dispatch → response → message.sent
```

---

## Configuration Reference

### Files

```
~/.omni/
├── config.json          # CLI config (apiUrl, apiKey)
├── data/
│   ├── pgserve/         # Embedded PostgreSQL data
│   ├── media/           # Downloaded media files
│   └── packages/        # Plugin packages
└── nats-server          # NATS binary
```

### Instance Options

| Flag | Default | Purpose |
|------|---------|---------|
| `--agent-provider <id>` | — | Link to OpenClaw provider |
| `--agent <id>` | `default` | Agent ID within the provider |
| `--agent-session-strategy` | `per_chat` | `per_user`, `per_chat`, or `per_thread` |
| `--agent-timeout` | `60` | Response timeout in seconds |
| `--agent-stream-mode` | `false` | Stream responses incrementally |
| `--agent-prefix-sender` | `true` | Prefix `[DisplayName]:` to messages |
| `--debounce-mode` | `randomized` | `disabled`, `fixed`, `randomized` |
| `--debounce-min-ms` | `0` | Min delay before dispatch |
| `--debounce-max-ms` | `0` | Max delay before dispatch |

### Service Management

```bash
omni start       # Start API + NATS
omni stop        # Stop all
omni restart     # Restart all
omni status      # Health + process table
omni logs        # PM2 logs (--process api|nats)
```

### Update

```bash
bun add -g @automagik/omni@latest && omni restart
```

---

## Troubleshooting

### `omni install` says "Server bundle not found"

```bash
bun remove -g @automagik/omni && bun add -g @automagik/omni@latest
```

### Health check fails after install

```bash
pm2 logs omni-api --lines 20 --nostream
```

Common causes:
- **Port conflict** — use `omni install --port <other>`
- **pgserve crash** — delete `~/.omni/data/pgserve` and restart
- **Missing bun** — ensure `which bun` works

### `omni status` shows `keyValid: no`

The API key in config doesn't match the server. Check both sides:
```bash
pm2 env omni-api | grep OMNI_API_KEY
cat ~/.omni/config.json | grep apiKey
```

Fix by updating the config:
```bash
omni config set apiKey <correct_key>
```

### OpenClaw error: `missing scope: operator.write`

The device keypair wasn't registered with the gateway. Re-run setup:
```bash
omni providers setup openclaw \
  --gateway-url ws://127.0.0.1:18789 \
  --gateway-token <TOKEN> \
  --agent-id <AGENT>
```

### Provider health check fails after delete/recreate

The API caches WebSocket connections. Restart to flush:
```bash
omni restart
omni providers test <PROVIDER_ID>
```

### Stale `omni-v2-pgserve` process

If you see port 8432 conflicts or `omni-v2-pgserve` in PM2:
```bash
pm2 delete omni-v2-pgserve
omni restart
```

The embedded pgserve backend runs in-process — a stale separate pgserve process conflicts with it.

---

## One-Liner (Full Setup from Zero)

```bash
curl -fsSL https://bun.sh/install | bash \
  && export PATH="$HOME/.bun/bin:$PATH" \
  && bun add -g pm2 @automagik/omni \
  && omni install --non-interactive
```

Then: create provider (Step 4) → create instance (Step 5) → verify (Step 6).
