# plugin-openclaw Setup Guide

## Prerequisites
- Omni v2 server running
- OpenClaw gateway running
- At least one Omni channel instance (Slack, Telegram, WhatsApp) configured

## Step 1: Create OpenClaw Provider in Omni
```bash
omni providers create \
  --schema openclaw \
  --name "khal" \
  --gateway-url "ws://localhost:18789" \
  --gateway-token "<from openclaw config>" \
  --agent-id "khal" \
  --session-strategy "per_user"
```

## Step 2: Get Provider ID
```bash
PROVIDER_ID=$(omni providers list --json | jq -r '.items[] | select(.name=="khal") | .id')
```

## Step 3: Link Instances to Provider
```bash
omni instances update <slack-instance-id>    --agent-provider-id $PROVIDER_ID
omni instances update <telegram-instance-id> --agent-provider-id $PROVIDER_ID
omni instances update <whatsapp-instance-id> --agent-provider-id $PROVIDER_ID
```

## Step 4: Create Scoped API Keys
```bash
omni keys create \
  --name "khal-slack" \
  --scopes "messages:read,messages:write" \
  --instance-ids "<slack-uuid>"

omni keys create \
  --name "khal-telegram" \
  --scopes "messages:read,messages:write" \
  --instance-ids "<telegram-uuid>"

# Repeat for WhatsApp
```

## Step 5: Configure OpenClaw
Add to OpenClaw config:
```yaml
plugins:
  load:
    paths: ['./packages/plugin-openclaw']

channels:
  omni:
    accounts:
      slack-khal:
        apiUrl: http://localhost:8882
        apiKey: <from omni keys create>
        instanceId: <slack-uuid>
      tg-khal:
        apiUrl: http://localhost:8882
        apiKey: <from omni keys create>
        instanceId: <telegram-uuid>
      wa-khal:
        apiUrl: http://localhost:8882
        apiKey: <from omni keys create>
        instanceId: <whatsapp-uuid>
```

## Step 6: Restart Gateway
```bash
openclaw gateway restart
```

## Verification
```bash
# Check accounts are running
openclaw channel status omni

# Check gateway logs
journalctl --user -u openclaw-gateway --since "5 min ago" | grep "omni:"
```

## Cross-Platform Identity (personId)

### How It Works
- Omni automatically links identities via phone number matching
- When a user sends their first message, Omni creates a `platformIdentity` + `person` record
- If the phone number matches an existing person, automatic cross-platform linking occurs

### Limitation
- Identity creation happens asynchronously
- On the very first message from a new user, `personId` may not be available yet
- **Fallback behavior:** Omni uses `chatId` as the session ID -- agent runs, but session is per-chat (not cross-platform)
- **Resolution:** After identity creation (~1-2 seconds), subsequent messages use `personId` -- cross-platform sessions work
- **Result:** A user's first WhatsApp message might create a separate session. From the second message onwards, WhatsApp + Telegram + Slack = same session.

### v2 Enhancement (Future)
- Expose `personId` in OpenClaw's WS metadata so the plugin can track cross-platform identity explicitly
- Add OpenClaw UI for managing Omni identity links
- Requires changes to both Omni's `openclaw` provider and OpenClaw's WS handler (tracked separately)

## Multi-Agent Setup
Each agent needs its own provider and scoped API keys:
```bash
# Create provider for second agent
omni providers create --schema openclaw --name "other-agent" ...

# Create separate keys scoped to specific instances
omni keys create --name "other-agent-slack" --instance-ids "<slack-uuid>"
```

API key scoping ensures agents can only send to their assigned instances.
