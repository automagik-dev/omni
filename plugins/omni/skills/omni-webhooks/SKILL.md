---
name: omni-webhooks
description: |
  Manage webhook event sources: create, update, and delete webhook endpoints, and trigger custom events for testing automations.
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Webhooks

## List webhooks

```bash
omni webhooks list --json
omni webhooks list --enabled --json
omni webhooks list --disabled --json
```

## Get webhook

```bash
omni webhooks get <id> --json
```

## Create webhook

```bash
omni webhooks create --name "My Webhook" --description "Receives external events" --json

# Create with expected headers for validation
omni webhooks create --name "Secure Hook" --headers '{"X-Secret": true}' --json

# Create in disabled state
omni webhooks create --name "Draft Hook" --disabled --json
```

## Update webhook

```bash
omni webhooks update <id> --name "Renamed Hook" --json
omni webhooks update <id> --description "Updated description" --json
omni webhooks update <id> --enable --json
omni webhooks update <id> --disable --json
```

## Delete webhook

```bash
omni webhooks delete <id> --json
```

## Trigger events

```bash
# Trigger a custom event for testing
omni webhooks trigger --type "custom.event" --payload '{"key": "value"}' --instance <id> --json

# Trigger with a correlation ID for tracing
omni webhooks trigger --type "order.created" --payload '{"orderId": "123"}' --instance <id> --correlation-id "req-abc" --json
```

## Notes

- Webhooks provide external event injection into Omni's event bus.
- Use `trigger` to test automations with custom payloads without an external caller.
- `--headers` defines expected request headers (used for webhook validation/security).
- Disabled webhooks will not process incoming events until enabled.
