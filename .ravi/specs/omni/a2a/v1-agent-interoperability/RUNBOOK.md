# A2A 1.0 Agent Interoperability / RUNBOOK

## Debug Flow

Use this when validating whether Omni currently has operational A2A support.

## 1. Confirm repo and branch

```bash
git -C /Users/luis/Dev/namastex/omni-v2 status --short --branch
```

Expected before edits: clean worktree on the intended branch.

## 2. Confirm runtime health

```bash
omni status --json
curl -s http://localhost:8882/api/v2/health | jq '.'
```

Check API version, database, NATS, and plugins.

## 3. Check whether A2A is loaded and configured

```bash
omni channels list --json | jq '.[] | select(.channel == "a2a")'
omni instances list --json | jq '[.[] | select(.channel == "a2a")]'
omni providers list --json | jq '[.[] | select(.schema == "a2a")]'
omni agents list --json
```

Interpretation:

- Plugin loaded means the code package registered.
- A2A instance count `0` means no inbound A2A runtime surface is configured.
- A2A provider count `0` means Omni is not configured to call external A2A
  agents.
- `A2A_ENABLED=false` or absent means `/a2a/*` is operationally disabled.

## 4. Probe discovery endpoints

```bash
curl -i http://localhost:8882/.well-known/agent-card.json
curl -i http://localhost:8882/.well-known/agent.json
```

Expected for v1.0 work:

- `/.well-known/agent-card.json` returns an A2A v1.0 Agent Card.
- The card includes `supportedInterfaces[]`.
- The card data corresponds to a real Omni agent.

Current legacy/failure signatures:

- HTML dashboard at `/.well-known/agent-card.json`.
- `{"error":"A2A not enabled"}` at the legacy endpoint.
- Static card name like `"Omni Agent"` with no real agent parameters.

## 5. Probe JSON-RPC v1.0 send

```bash
curl -i \
  -H 'A2A-Version: 1.0' \
  -H 'Content-Type: application/json' \
  -X POST http://localhost:8882/a2a/<agent-or-instance-id> \
  --data '{"jsonrpc":"2.0","id":"smoke","method":"SendMessage","params":{"message":{"role":"ROLE_USER","parts":[{"text":"ping","mediaType":"text/plain"}],"messageId":"smoke-msg"}}}'
```

Expected for v1.0 work:

- Method is `SendMessage`, not `message/send`.
- Request uses `ROLE_USER`.
- Parts use member fields like `text`, not `type`.
- Response result contains a v1.0 `task` or `message`.

## 6. Search for legacy protocol shapes

```bash
rg -n "message/send|message/stream|tasks/get|tasks/cancel|agent.json|final: true|role: 'user'|state: 'completed'|type: 'text'" \
  packages/channel-a2a packages/core/src/providers packages/api/src
```

Legacy hits may be acceptable in compatibility tests/docs, but v1.0 code paths
must not depend on them.

## 7. Run focused tests

```bash
cd /Users/luis/Dev/namastex/omni-v2
bun test packages/channel-a2a packages/core/src/providers/__tests__/a2a-client.test.ts packages/api/src/__tests__/a2a-integration.test.ts
bun run typecheck
```

Add or update tests whenever the protocol shape changes.
