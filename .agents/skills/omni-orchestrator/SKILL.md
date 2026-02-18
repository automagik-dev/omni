---
name: omni-orchestrator
description: Omni v2 instance orchestration specialist — use for setting up channels (WhatsApp, Telegram, Discord, Slack), configuring agent routing, managing instances lifecycle, and configuring providers via the omni CLI.
version: "1.0"
---

# Omni Orchestrator

## Prerequisites

- `omni` CLI installed and in PATH (`omni auth login --api-key sk_xxx --api-url <url>`)
- `jq` available for JSON processing

## Channel Setup

### Telegram

```bash
omni channels add --type telegram --name "My Telegram" --bot-token "123456:ABC-DEF"
```

### Discord

```bash
omni channels add --type discord --name "My Discord" --bot-token "MTIzNDU2.abc.def" --guild-id "123456789"
```

### Slack

```bash
omni channels add --type slack --name "My Slack" --app-token "<your-app-token>" --bot-token "<your-bot-token>"
```

### WhatsApp

```bash
# Create instance
omni instances create --channel whatsapp --name "My WhatsApp"

# Connect via QR
omni instances qr <id> --watch

# Or via pairing code
omni instances pair <id> --phone +5511999999999
```

## Instance Lifecycle

```bash
omni instances list
omni instances status <id>
omni instances connect <id>
omni instances disconnect <id>
omni instances restart <id>
omni instances logout <id>
```

## Sync Operations

```bash
omni instances sync <id> --type messages --depth 7d
omni instances sync <id> --type contacts
omni instances sync <id> --type groups
omni instances sync <id> --type all
omni instances syncs <id>  # Check sync status
```

## Agent Routing

Configure AI agent routing for an instance:

```bash
omni instances update <id> --agent-routing '{"providerId":"openai-1","model":"gpt-4o"}'
```

## Reply Filters

Control which contacts the bot responds to:

### Whitelist Mode

```bash
omni instances update <id> --reply-filter '{"mode":"whitelist","contacts":["5511999@s.whatsapp.net"]}'
```

### Blacklist Mode

```bash
omni instances update <id> --reply-filter '{"mode":"blacklist","contacts":["5511888@s.whatsapp.net"]}'
```

## Debounce Configuration

```bash
# Group debounce (wait for silence before responding)
omni instances update <id> --debounce '{"type":"group","delay":5000}'

# Per-message debounce
omni instances update <id> --debounce '{"type":"delay","delay":2000}'

# No debounce
omni instances update <id> --debounce '{"type":"none"}'
```

## Access Modes

```bash
omni instances update <id> --access-mode "public"    # Anyone can interact
omni instances update <id> --access-mode "private"   # Only whitelisted contacts
omni instances update <id> --access-mode "disabled"  # Bot disabled
```

## Providers

```bash
omni providers create --name "openai" --type openai --api-key sk_xxx
omni providers test <provider-id>
omni providers list
```
