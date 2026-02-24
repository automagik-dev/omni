---
name: omni-install
description: Install and bootstrap Omni server + CLI from scratch. Use when omni is not running, not installed, or the user needs a full fresh setup.
allowed-tools: Bash(omni *), Bash(bun *), Bash(pm2 *), Bash(curl *), Bash(jq *), Bash(cat *), Bash(ls *), Bash(which *)
---

# Omni Install

Use this when `omni status` fails, server is not running, or user needs a full fresh install.

## Step 0 — Diagnose first

```bash
which omni 2>/dev/null && omni --version || echo "CLI not installed"
pm2 list 2>/dev/null | grep omni || echo "no omni processes"
curl -s http://localhost:8882/api/v2/health | jq .status || echo "server not reachable"
```

Decide which steps to skip based on what's already present.

## Step 1 — Install prerequisites

```bash
# Bun (if missing)
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
bun --version   # must show 1.x

# PM2 (if missing)
bun add -g pm2
pm2 --version
```

## Step 2 — Install Omni CLI

```bash
bun add -g @automagik/omni
omni --version
# expected: 2.260223.x or later
```

If CLI was already installed but outdated:
```bash
bun add -g @automagik/omni@latest
```

## Step 3 — Run the server installer

```bash
omni install --non-interactive
```

This bootstraps everything with sane defaults:
- **Port:** 8882
- **Database:** Embedded PGlite (no external PostgreSQL needed)
- **Event bus:** NATS JetStream (auto-downloaded)
- **Process manager:** PM2
- **API key:** Auto-generated — printed once, **save it immediately**

Expected output:
```
✓ bun available
✓ port 8882 is free
✓ NATS binary found at ~/.omni/nats-server
✔ omni-api started
✔ omni-nats started
✔ Server is healthy
✓ Config written to ~/.omni/config.json

✓ Omni v2.260223.x is running!
API:    http://localhost:8882
Key:    omni_sk_<hex>       ← SAVE THIS
```

Custom port:
```bash
omni install --non-interactive --port 9000
```

## Step 4 — Verify

```bash
# All three must pass:
omni status --json
curl -s http://localhost:8882/api/v2/health | jq '{status, version}'
omni auth status --json
```

Expected: `omni-api online`, `omni-nats online`, `status: healthy`, `status: authenticated`.

## Step 5 — Connect to OpenClaw

```bash
omni providers setup openclaw \
  --gateway-url ws://127.0.0.1:18789 \
  --gateway-token <GATEWAY_TOKEN> \
  --agent-id <AGENT_ID>
```

- `GATEWAY_TOKEN` → from `openclaw gateway status` or gateway config
- `AGENT_ID` → the agent name in OpenClaw (e.g. `omni`, `eva`, `khal`)

Save the **Provider ID** from the output.

## Step 6 — Create channel instances

### Telegram
```bash
omni instances create \
  --channel telegram \
  --name "my-telegram" \
  --telegram-token "<BOT_TOKEN>" \
  --agent-provider <PROVIDER_ID> \
  --agent <AGENT_ID>
```
Get bot token from [@BotFather](https://t.me/BotFather).

### Discord
```bash
omni instances create \
  --channel discord \
  --name "my-discord" \
  --discord-token "<BOT_TOKEN>" \
  --agent-provider <PROVIDER_ID> \
  --agent <AGENT_ID>
```

### Slack
```bash
omni instances create \
  --channel slack \
  --name "my-slack" \
  --slack-app-token "<APP_TOKEN>" \
  --slack-bot-token "<BOT_TOKEN>" \
  --agent-provider <PROVIDER_ID> \
  --agent <AGENT_ID>
```

### WhatsApp
```bash
omni instances create \
  --channel whatsapp-baileys \
  --name "my-whatsapp" \
  --agent-provider <PROVIDER_ID> \
  --agent <AGENT_ID>

# Then scan QR:
omni instances qr <INSTANCE_ID>
# Or pair by phone:
omni instances pair <INSTANCE_ID> --phone "+5511999999999"
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Server bundle not found" | `bun remove -g @automagik/omni && bun add -g @automagik/omni@latest` |
| Health check fails after install | `pm2 logs omni-api --lines 20 --nostream` — check for port conflict or PGlite crash |
| Port conflict | `omni install --port 9000` |
| PGlite crash | `rm -rf ~/.omni/data/pglite && omni restart` |
| `keyValid: no` | `pm2 env omni-api \| grep OMNI_API_KEY` → `omni config set apiKey <correct_key>` |
| `missing scope: operator.write` | Re-run `omni providers setup openclaw ...` |
| Stale `omni-v2-pgserve` process | `pm2 delete omni-v2-pgserve && omni restart` |

## Service management

```bash
omni start    # Start API + NATS
omni stop     # Stop all
omni restart  # Restart all
omni logs     # PM2 logs (--process api|nats)
```

## One-liner (zero to running)

```bash
curl -fsSL https://bun.sh/install | bash \
  && export PATH="$HOME/.bun/bin:$PATH" \
  && bun add -g pm2 @automagik/omni \
  && omni install --non-interactive
```

Then: Step 5 (provider) → Step 6 (instance) → verify end-to-end.
