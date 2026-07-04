# Automations — Event-Driven Workflows

Fire on a trigger event when conditions match, then run an action: `call_agent`, `webhook`, `send_message`, `emit_event`, or `log`.

## Commands

```bash
omni automations list --enabled --json      # or --disabled
omni automations get <id> --json

omni automations create --name "Support Bot" --trigger message.received \
  --action call_agent --agent-id <agentId> --provider-id <providerId> \
  --response-as agentResponse --priority 100 --json
omni automations create --name "Forward" --trigger message.received \
  --action webhook --action-config '{"url":"https://example.com/hook"}' --json
omni automations create --name "Log texts" --trigger message.received --action log \
  --condition '[{"field":"messageType","operator":"equals","value":"text"}]' --condition-logic and --json

omni automations update <id> --name "New Name" --priority 200 --json
omni automations enable <id> --json
omni automations disable <id> --json
omni automations delete <id> --json

omni automations test <id> --event '{"type":"message.received","payload":{}}' --json
omni automations execute <id> --event '{"type":"message.received","payload":{"text":"hi"}}' --json
omni automations logs <id> --limit 50 --json
```

`test` evaluates with a mock event and no side effects; `execute` runs the real actions — treat it like production traffic.

## Patterns

```bash
# Enabled automations with triggers
omni automations list --enabled --json | jq '.[] | {id, name, trigger, action, priority}'

# Recent failures
omni automations logs <id> --limit 10 --json | jq '.[] | select(.status == "failed") | {id, error, executedAt}'
```
