# Sofia Telegram → OpenClaw Onboarding

> How to wire an OpenClaw agent to receive/respond via Telegram through Omni.

## Architecture

```
Telegram User → @GenieSofiaBot → Omni (Telegram plugin) → OpenClaw Gateway (WS)
                                                          → agent:sofia:omni-<chatId>
                                                          → Sofia responds
                                                          ← Omni sends reply to Telegram
```

## Prerequisites

- Omni server running with Telegram channel plugin
- OpenClaw Gateway running on the same network
- A Telegram bot created via @BotFather
- An Omni API key with `providers:write` + `instances:write` scopes

## Step 1: Create an OpenClaw Provider

```bash
omni providers create \
  --name "sofia-openclaw" \
  --schema openclaw \
  --base-url "ws://<OPENCLAW_HOST>:18789" \
  --api-key "<OPENCLAW_GATEWAY_TOKEN>" \
  --description "OpenClaw Gateway for Sofia agent"
```

Or via API:
```bash
curl -X POST "$OMNI_API/providers" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $OMNI_KEY" \
  -d '{
    "name": "sofia-openclaw",
    "schema": "openclaw",
    "baseUrl": "ws://<OPENCLAW_HOST>:18789",
    "apiKey": "<OPENCLAW_GATEWAY_TOKEN>",
    "schemaConfig": {"defaultAgentId": "sofia"},
    "defaultStream": true,
    "defaultTimeout": 60,
    "supportsStreaming": true
  }'
```

The `schemaConfig.defaultAgentId` sets which OpenClaw agent handles messages.
The provider ID is returned in the response.

## Step 2: Create or Update the Telegram Instance

If the instance already exists:
```bash
omni instances update <INSTANCE_ID> \
  --agent-provider "<PROVIDER_ID>" \
  --agent "sofia"
```

If creating new:
```bash
omni instances create \
  --name "sofia-telegram" \
  --channel telegram \
  --agent-provider "<PROVIDER_ID>" \
  --agent "sofia"
```

## Step 3: Connect with Bot Token

```bash
omni instances connect <INSTANCE_ID> --token "<TELEGRAM_BOT_TOKEN>"
```

Or via API:
```bash
curl -X POST "$OMNI_API/instances/<INSTANCE_ID>/connect" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $OMNI_KEY" \
  -d '{"token": "<TELEGRAM_BOT_TOKEN>"}'
```

## Step 4: Verify

```bash
omni instances status <INSTANCE_ID>
# Expected: state: "connected", isConnected: true
```

## Step 5: Smoke Test

Send a message to your bot on Telegram. Check:
1. Omni API logs show the message arriving
2. OpenClaw receives and dispatches to the agent
3. Agent response flows back through Omni to Telegram

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `state: disconnected` | Bot token not set or invalid | Re-run `omni instances connect` with correct token |
| No response from agent | OpenClaw Gateway unreachable | Check WS URL is reachable from Omni server |
| `OpenClawClient export warning` | Missing barrel export | Non-fatal, doesn't affect functionality |
| Instance disconnects on API restart | Bot token not persisted in DB | Reconnect after restart, or persist token via SQL |

## Current Setup (Production)

| Component | Value |
|-----------|-------|
| Instance | `sofia-telegram` (`710fc1da-bd52-4c15-9d94-ca84c453d107`) |
| Provider | `sofia-openclaw-prod` (`dab06a5c-fcaf-40fb-bf6b-933b15411f21`) |
| Gateway | `ws://10.114.1.111:18789` |
| Agent ID | `sofia` |
| Bot | `@GenieSofiaBot` |
| Status | ❌ Disconnected (needs bot token) |

---

_Created: 2026-02-11_
