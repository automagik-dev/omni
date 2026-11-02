# Automations — Event-Driven Workflows

Fire on a trigger event when conditions match, then run ordered actions: `call_agent`, `webhook`, `send_message`, `emit_event`, `log`, or `connector.call`. Inspect `omni automations --help` and `omni automations create --help` for the installed CLI. Create disabled and dry-run before enabling.

## Commands

```bash
omni automations list --enabled --json      # or --disabled
omni automations get <id> --json

omni automations create --name "Support Bot" --trigger message.received \
  --action call_agent --agent-id <agentId> --provider-id <providerId> \
  --response-as agentResponse --priority 100 --disabled --json
omni automations create --name "Forward" --trigger message.received \
  --action webhook --action-config '{"url":"https://example.com/hook"}' --disabled --json
omni automations create --name "Log texts" --trigger message.received --action log \
  --condition '[{"field":"content.type","operator":"eq","value":"text"}]' --condition-logic and --disabled --json

omni automations update <id> --name "New Name" --priority 200 --json
omni automations enable <id> --json               # resumes from now; no automatic catch-up
omni automations enable <id> --replay-since <iso-timestamp> --json  # explicit catch-up: real actions
omni automations disable <id> --json
omni automations delete <id> --json

omni automations test <id> --event '{"type":"message.received","payload":{}}' --json
omni automations execute <id> --event '{"type":"message.received","payload":{"text":"hi"}}' --json
omni automations logs <id> --limit 50 --json
```

`call_agent` config `waitForResponse` (default `true`) mirrors `webhook`'s: set `false` to return the `runId` as soon as the run is dispatched; the outcome lands later as a `system.agent.run_completed` event (`automationId`, `executionId`, `runId`, `status`, `response`/`error`). `responseAs` is rejected with `waitForResponse: false`.

`test --event` accepts mock JSON or a real journaled event ID; without `--execute` it returns condition/action verdicts without running actions. Both `test --execute` and `execute` run real actions: treat them like production traffic. Disabling skips events for good; enabling resumes from that moment unless `--replay-since` explicitly opts into catch-up.

## Definitions and concurrency

```bash
omni automations scaffold message.received --action log --json > ./automation.json
# Inspect/edit the stub, including enabled:false, before creating it.
omni automations create --file ./automation.json --disabled --json
omni automations update <id> --file ./automation.json --json
omni automations test <id> --event <journal-event-id> --json
```

`create/update --file` accepts a full JSON definition; explicit flags override file fields. Repeat `--action` for ordered multi-action definitions; the i-th `--action-config` pairs with the i-th action. `--max-concurrency` caps this automation's concurrent runs; `--concurrency-key` partitions that queue using a payload template. `--transactional-emissions` buffers `emit_event` publishes until every action succeeds; it does not roll back external sends or webhook effects. Use create/update help for these options and inspect the saved definition before enabling. Conditions use payload dot paths, e.g. `content.type`, with operators such as `eq` (not `equals`).

## Patterns

```bash
# Enabled automations with triggers
omni automations list --enabled --json | jq '.[] | {id, name, trigger, priority}'

# Recent failures
omni automations logs <id> --limit 10 --json | jq '.[] | select(.status == "failed") | {id, error, executedAt}'
```
