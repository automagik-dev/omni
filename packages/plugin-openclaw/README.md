# @omni/plugin-openclaw

Expose Omni v2 as a native messaging channel in OpenClaw. This plugin handles **outbound** messaging (OpenClaw -> Omni), while **inbound** messages flow through Omni's built-in `openclaw` provider (WebSocket).

## Architecture

```
Inbound:  User (Slack/TG/WA) -> Omni -> openclaw provider (WS) -> OpenClaw Gateway
Outbound: OpenClaw Gateway -> plugin-openclaw -> Omni REST API -> User (Slack/TG/WA)
```

## Features

- **sendText** -- Send text messages via Omni REST API
- **sendMedia** -- Send media (images, documents) via Omni REST API
- **react** -- React to messages with emoji
- **read** -- Mark messages as read
- **reply** -- Reply to specific messages
- **Health monitoring** -- Periodic health checks on Omni server

## Configuration

```yaml
channels:
  omni:
    accounts:
      slack-khal:
        apiUrl: http://localhost:8882
        apiKey: <scoped-api-key>
        instanceId: <omni-instance-uuid>
```

Each account maps to one Omni instance. Use one account per channel (e.g., `wa-khal`, `tg-khal`, `slack-khal`).

## Setup

See [SETUP.md](./SETUP.md) for the full wiring guide (Omni provider creation, instance linking, API key setup).

## Cross-Platform Identity

Omni resolves cross-platform identity via `personId`:
- Same phone number across WhatsApp, Telegram, Slack -> same person
- OpenClaw sessions converge to one session per person (after first message)
- See SETUP.md for limitations and v2 plans

## Multi-Agent Support

Multiple OpenClaw agents can share the same Omni server:
- Each agent gets its own Omni `provider` entry
- API keys are scoped per-instance for isolation
- No code changes needed -- just config

## Plugin Structure

```
src/
  index.ts      -- Plugin entry point (register)
  channel.ts    -- Channel definition (config, capabilities, adapter wiring)
  outbound.ts   -- Outbound adapter (sendText, sendMedia)
  actions.ts    -- Message actions (react, read, reply, send)
  gateway.ts    -- Gateway adapter (health ping monitor)
  runtime.ts    -- PluginRuntime singleton
  types.ts      -- Type definitions
```

## Troubleshooting

### Plugin won't load
- Check `openclaw.plugin.json` exists and `"channels": ["omni"]` is set
- Verify the plugin path in OpenClaw config under `plugins.load.paths`

### Messages not sending
- Check API key is valid: `curl -H "x-api-key: <key>" <apiUrl>/health`
- Verify instanceId matches the Omni instance UUID
- Check gateway logs: `journalctl --user -u openclaw-gateway | grep "omni:"`

### Health check warnings
- `health check returned 503` -- Omni server may be restarting, plugin will retry
- `health check failed` -- Network issue, check Omni server is reachable

### Cross-platform sessions not merging
- First message creates a per-chat session (expected)
- Subsequent messages should use personId (cross-platform)
- Check Omni identity resolution: `omni persons list`
