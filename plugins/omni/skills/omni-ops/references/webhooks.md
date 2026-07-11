# Webhooks — Custom Event Sources

External endpoints that inject custom events into Omni's event bus — integrate outside systems or feed automations with custom payloads.

## Commands

```bash
omni webhooks list --enabled --json      # or --disabled
omni webhooks get <id> --json

omni webhooks create --name "My Webhook" --description "Receives external events" --json
omni webhooks create --name "Secure Hook" --headers '{"X-Webhook-Secret": true}' --json   # required request headers
omni webhooks create --name "Draft Hook" --disabled --json

omni webhooks update <id> --name "Renamed" --json
omni webhooks update <id> --enable --json      # or --disable
omni webhooks delete <id> --json

# Inject a custom event
omni webhooks trigger --type "order.created" --payload '{"orderId":"123"}' --instance <id> --correlation-id "req-abc" --json
```

## Pattern — fire a test event and trace it

```bash
omni webhooks trigger --type "test.ping" --payload '{}' --instance <id> --correlation-id "test-001" --json
omni journey show "test-001"
```
