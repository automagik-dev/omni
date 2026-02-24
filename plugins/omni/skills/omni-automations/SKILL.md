---
name: omni-automations
description: |
  Create and operate Omni automations: CRUD, enable/disable, test/execute with event payloads, and inspect execution logs.
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Automations

## Create

```bash
# call_agent action
omni automations create \
  --name "Support Bot" \
  --trigger message.received \
  --action call_agent \
  --agent-id support-agent \
  --provider-id provider-1 \
  --response-as agentResponse \
  --condition '[{"field":"messageType","operator":"equals","value":"text"}]' \
  --condition-logic and \
  --priority 100 \
  --json

# generic action config
omni automations create \
  --name "Forward" \
  --trigger message.received \
  --action webhook \
  --action-config '{"url":"https://example.com/hook"}' \
  --json
```

## Read and update

```bash
omni automations list --json
omni automations list --enabled --json
omni automations get <id> --json
omni automations update <id> --name "New Name" --description "Updated" --priority 200 --json
```

## State and execution

```bash
omni automations enable <id> --json
omni automations disable <id> --json

omni automations test <id> --event '{"type":"message.received","payload":{}}' --json
omni automations execute <id> --event '{"type":"message.received","payload":{"text":"hi"}}' --json

omni automations logs <id> --limit 50 --json
omni automations delete <id> --json
```

## Notes

- `test` and `execute` accept `--event <json>` (there is no `--dry-run` flag).
- Action types include: `webhook`, `send_message`, `emit_event`, `log`, `call_agent`.
