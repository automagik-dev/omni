# A2A 1.0 Agent Interoperability / CHECKS

## Checks

## Static checks

```bash
rg -n "agent-card.json|supportedInterfaces|SendMessage|SendStreamingMessage|GetTask|ListTasks|CancelTask|SubscribeToTask|ROLE_USER|ROLE_AGENT|TASK_STATE_" \
  packages/channel-a2a packages/core/src/providers packages/api/src packages/sdk
```

```bash
rg -n "message/send|message/stream|tasks/get|tasks/cancel|agent.json|final: true|role: 'user'|role: \"user\"|state: 'completed'|state: \"completed\"|type: 'text'|type: \"text\"" \
  packages/channel-a2a packages/core/src/providers packages/api/src
```

Expected:

- v1.0 implementation paths contain operation names and enum values.
- Legacy names appear only in compatibility tests, migration docs, or explicit
  legacy code paths.

## Runtime checks

```bash
omni status --json
omni channels list --json | jq '.[] | select(.channel == "a2a")'
omni instances list --json | jq '[.[] | select(.channel == "a2a")]'
omni providers list --json | jq '[.[] | select(.schema == "a2a")]'
omni agents list --json
```

Expected before claiming operational A2A:

- API is healthy.
- A2A plugin is loaded.
- At least one A2A inbound surface or per-agent endpoint is configured.
- Agent records have the metadata/card fields required for discovery.

## Agent Card contract checks

For each discoverable agent/card:

- Card is available at `/.well-known/agent-card.json` or a documented per-agent
  card URL.
- Card has `name`, `description`, `version`, `capabilities`,
  `defaultInputModes`, `defaultOutputModes`, `skills`, and
  `supportedInterfaces`.
- Each `supportedInterfaces[]` entry has `url`, `protocolBinding`, and
  `protocolVersion`.
- No public card contains raw secrets.
- Skills include stable `id`, `name`, `description`, `tags`, `inputModes`,
  `outputModes`, and useful examples when available.

## Protocol smoke checks

JSON-RPC v1.0 send:

```bash
curl -i \
  -H 'A2A-Version: 1.0' \
  -H 'Content-Type: application/json' \
  -X POST http://localhost:8882/a2a/<agent-or-instance-id> \
  --data '{"jsonrpc":"2.0","id":"smoke","method":"SendMessage","params":{"message":{"role":"ROLE_USER","parts":[{"text":"ping","mediaType":"text/plain"}],"messageId":"smoke-msg"}}}'
```

Task retrieval after a task is created:

```bash
curl -i \
  -H 'A2A-Version: 1.0' \
  -H 'Content-Type: application/json' \
  -X POST http://localhost:8882/a2a/<agent-or-instance-id> \
  --data '{"jsonrpc":"2.0","id":"task","method":"GetTask","params":{"id":"<task-id>","historyLength":10}}'
```

Streaming smoke:

```bash
curl -N \
  -H 'A2A-Version: 1.0' \
  -H 'Accept: text/event-stream' \
  -H 'Content-Type: application/json' \
  -X POST http://localhost:8882/a2a/<agent-or-instance-id> \
  --data '{"jsonrpc":"2.0","id":"stream","method":"SendStreamingMessage","params":{"message":{"role":"ROLE_USER","parts":[{"text":"stream ping","mediaType":"text/plain"}],"messageId":"stream-msg"}}}'
```

Expected:

- Send response contains v1.0 `task` or `message`.
- Stream frames are JSON-RPC responses whose `result` is a v1.0
  `StreamResponse`.
- Task states use `TASK_STATE_*`.
- Roles use `ROLE_*`.
- Parts do not require `type` or `kind`.

## Automated tests

```bash
cd /Users/luis/Dev/namastex/omni-v2
bun test packages/channel-a2a
bun test packages/core/src/providers/__tests__/a2a-client.test.ts
bun test packages/api/src/__tests__/a2a-integration.test.ts
bun run typecheck
```

Required regression coverage:

- Agent card v1.0 shape and no top-level-only `url`.
- Multi-agent discovery returns separate parameters for separate agents.
- `SendMessage` emits an Omni `message.received` with enough routing/task
  context.
- `GetTask` returns only tasks visible to caller.
- `SendStreamingMessage` emits v1.0 stream frames and closes on terminal state.
- A2A client/provider selects an interface from `supportedInterfaces[]`.
