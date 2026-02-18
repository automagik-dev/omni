# @omni/plugin-openclaw

Registers Omni v2 as a native messaging channel in OpenClaw Gateway.

## Install

```bash
openclaw plugins install @omni/plugin-openclaw
```

## Config

Add to your OpenClaw config under `channels.omni.accounts`:

```yaml
channels:
  omni:
    accounts:
      my-instance:
        apiUrl: http://localhost:8882
        apiKey: sk_your_key_here
        instanceId: your-instance-uuid
        enabled: true
```

## Usage

After install, restart the OpenClaw Gateway. The `omni` channel will appear in channel selection. Agents can route messages to any Omni instance via the `omni` channel ID.

## Inbound Messages

The plugin subscribes to the Omni SSE event stream (`/v2/events/stream`) and forwards `message.received` events to OpenClaw agents as inbound messages.
