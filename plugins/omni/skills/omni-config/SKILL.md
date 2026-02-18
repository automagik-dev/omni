---
name: omni-config
description: |
  Configure the Omni CLI — authenticate with API keys, set base URL, manage default instance, configure providers, and manage webhooks.
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Config

Configure the Omni CLI and manage platform settings.

## Authentication

```bash
omni auth login --api-key sk_xxx --api-url http://localhost:8882
omni auth status
omni auth logout
```

Config file: `~/.omni/config.json` (mode 0o600)

## CLI Configuration

```bash
# Set default instance
omni config set defaultInstance <id>

# Set API URL
omni config set apiUrl http://localhost:8882

# Set default output format
omni config set format json

# View all config
omni config list

# Get specific value
omni config get defaultInstance

# Remove setting
omni config unset defaultInstance
```

### Available Config Keys

| Key | Description | Default |
|-----|-------------|---------|
| `apiUrl` | API endpoint | `http://localhost:8882` |
| `apiKey` | Authentication token | — |
| `defaultInstance` | Default instance ID | — |
| `format` | Output format | `human` |
| `showCommands` | Visibility | `core,standard,advanced` |

### Environment Overrides

```bash
export OMNI_FORMAT=json
export OMNI_SHOW_COMMANDS=all
```

## Providers

```bash
omni providers create --name "openai" --type openai --api-key sk_xxx
omni providers test <provider-id>
omni providers list
```

## Webhooks

```bash
omni webhooks create --url https://example.com/hook --events message.received
omni webhooks list
omni webhooks delete <id>
```

## System Status

```bash
omni status
```

Shows: config directory, API URL reachability, auth status, key validity, default instance, output format.
