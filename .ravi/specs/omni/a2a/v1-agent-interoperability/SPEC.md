---
id: omni/a2a/v1-agent-interoperability
title: "A2A 1.0 Agent Interoperability"
kind: feature
domain: omni
capabilities:
  - a2a
tags:
  - a2a
  - v1
  - agent-card
  - discovery
  - task-lifecycle
  - json-rpc
  - provider
applies_to:
  - packages/channel-a2a/src/types.ts
  - packages/channel-a2a/src/agent-card.ts
  - packages/channel-a2a/src/a2a-handler.ts
  - packages/channel-a2a/src/plugin.ts
  - packages/channel-a2a/src/stream-store.ts
  - packages/core/src/providers/a2a-client.ts
  - packages/core/src/providers/a2a-provider.ts
  - packages/api/src/app.ts
  - packages/api/src/routes/v2/agents.ts
  - packages/api/src/routes/v2/providers.ts
  - packages/db/src/schema.ts
owners:
  - Luis Filipe
status: active
normative: true
---

# A2A 1.0 Agent Interoperability

## Intent

Omni MUST expose selected Omni agents through a conformant A2A 1.0 interface so
another internal system can discover available agents, inspect each agent's
individual parameters/capabilities, and talk to those agents through Omni.

## Invariants

- A2A 1.0 interoperability MUST use the official A2A v1.0 semantic model:
  `AgentCard`, `AgentInterface`, `AgentSkill`, `Message`, `Part`, `Task`,
  `StreamResponse`, and standard operation names.
- Discovery MUST support the v1.0 well-known card path
  `/.well-known/agent-card.json`. The legacy `/.well-known/agent.json` path MAY
  exist only as a compatibility alias and MUST NOT be the only discovery path.
- The public Agent Card MUST contain `supportedInterfaces[]`; each interface
  MUST include `url`, `protocolBinding`, and `protocolVersion`.
- `protocolVersion` MUST be declared per `AgentInterface`, not as a top-level
  Agent Card field.
- The Agent Card MUST NOT use top-level `url` as the only service endpoint in
  v1.0. The primary endpoint MUST be `supportedInterfaces[0].url`.
- The Agent Card MUST describe real Omni agents. It MUST NOT use hardcoded
  `agentName`, `instanceName`, `capabilities`, or `skills` when an agent record
  is available.
- Multi-agent discovery MUST be explicit. Because A2A well-known discovery is
  one card per URL, Omni MUST provide either per-agent card URLs, tenant-based
  interfaces, or an internal registry/list endpoint for enumerating many agents.
- Per-agent parameters MUST be returned in a stable, documented shape. Required
  data includes agent id, display name, description, provider/provider schema,
  model when known, skill list, input/output media types, security
  requirements, endpoint/interface selection, and custom parameters from
  `agentCard`/`metadata`.
- Omni MUST NOT put static API keys, bearer tokens, private credentials, or
  internal-only secrets inside public Agent Cards.
- Sensitive or detailed parameters SHOULD be served through authenticated
  extended cards when needed.
- A2A requests MUST process the `A2A-Version` service parameter from HTTP
  headers or request parameters. v1.0 clients SHOULD send `A2A-Version: 1.0`.
- If a requested version is unsupported, Omni MUST return the A2A version error
  instead of silently treating the request as another version.
- The first conformant binding SHOULD be JSON-RPC because Omni already has a
  JSON-RPC skeleton. Omni MAY add HTTP+JSON/REST later, but the Agent Card MUST
  advertise only implemented bindings.
- JSON-RPC v1.0 operation names MUST use `SendMessage`,
  `SendStreamingMessage`, `GetTask`, `ListTasks`, `CancelTask`, and
  `SubscribeToTask`. Legacy method names like `message/send`, `message/stream`,
  `tasks/get`, and `tasks/cancel` MUST NOT be used for the v1.0 interface.
- HTTP+JSON/REST, if advertised, MUST use v1.0 paths such as
  `POST /message:send`, `POST /message:stream`, `GET /tasks/{id}`,
  `GET /tasks`, `POST /tasks/{id}:cancel`, and
  `GET /tasks/{id}:subscribe`.
- Message roles MUST use v1.0 enum values such as `ROLE_USER` and `ROLE_AGENT`.
- Task states MUST use v1.0 enum values such as `TASK_STATE_SUBMITTED`,
  `TASK_STATE_WORKING`, `TASK_STATE_COMPLETED`, `TASK_STATE_FAILED`,
  `TASK_STATE_CANCELED`, `TASK_STATE_REJECTED`,
  `TASK_STATE_INPUT_REQUIRED`, and `TASK_STATE_AUTH_REQUIRED`.
- Parts MUST use v1.0 member-based discrimination: `text`, `data`, `url`, or
  `raw`, with `mediaType` when applicable. v1.0 parts MUST NOT require `type`,
  `kind`, or nested `file` discriminators.
- `SendMessage` MUST return a v1.0 `SendMessageResponse` containing either a
  `task` or a `message`.
- `SendStreamingMessage` and `SubscribeToTask` MUST stream v1.0
  `StreamResponse` payloads. JSON-RPC SSE frames MUST wrap each event as a
  JSON-RPC response with `result`.
- Streaming v1.0 MUST NOT rely on a `final` boolean. Terminal state plus stream
  closure MUST define completion.
- A2A tasks MUST have a durable task mapping before Omni claims support for
  `GetTask`, `ListTasks`, `CancelTask`, or `SubscribeToTask`.
- Task visibility MUST be scoped to the authenticated caller/agent. A caller
  MUST NOT be able to fetch another caller's private tasks by guessing IDs.
- The A2A server path MUST enter Omni through normal dispatcher semantics so
  routing, access control, debounce/gating, provider selection, and async
  response handling remain consistent with other channels.
- The A2A provider/client path MUST resolve an external Agent Card, select a
  compatible interface, send the correct v1.0 operation shape, and parse v1.0
  task/message/stream responses.

## Validation

- `curl -i http://localhost:8882/.well-known/agent-card.json`
- `curl -i http://localhost:8882/.well-known/agent.json`
- `curl -i -H 'A2A-Version: 1.0' -H 'Content-Type: application/json' -X POST http://localhost:8882/a2a/<agent-or-instance-id> --data '{"jsonrpc":"2.0","id":"smoke","method":"SendMessage","params":{"message":{"role":"ROLE_USER","parts":[{"text":"ping","mediaType":"text/plain"}],"messageId":"smoke-msg"}}}'`
- `omni channels list --json | jq '.[] | select(.channel == "a2a")'`
- `omni instances list --json | jq '[.[] | select(.channel == "a2a")]'`
- `omni providers list --json | jq '[.[] | select(.schema == "a2a")]'`
- `omni agents list --json`
- `rg -n "agent-card.json|supportedInterfaces|SendMessage|SendStreamingMessage|GetTask|ListTasks|CancelTask|SubscribeToTask|ROLE_USER|TASK_STATE_" packages/channel-a2a packages/core/src/providers packages/api/src`
- `rg -n "message/send|message/stream|tasks/get|tasks/cancel|agent.json|final: true|role: 'user'|state: 'completed'|type: 'text'" packages/channel-a2a packages/core/src/providers packages/api/src`
- `cd /Users/luis/Dev/namastex/omni-v2 && bun test packages/channel-a2a packages/core/src/providers/__tests__/a2a-client.test.ts packages/api/src/__tests__/a2a-integration.test.ts`
- `cd /Users/luis/Dev/namastex/omni-v2 && bun run typecheck`

## Known Failure Modes

- Claiming A2A 1.0 while serving only the legacy `/.well-known/agent.json`
  endpoint.
- Returning an Agent Card without `supportedInterfaces[]`, causing v1.0 clients
  to fail interface selection.
- Advertising multiple agents without a registry/per-agent URL/tenant strategy,
  leaving clients unable to discover individual Omni agents.
- Serving the same hardcoded card for all agents and losing individual
  parameters.
- Mixing v0.3 JSON-RPC method names with v1.0 message/task schemas.
- Returning lowercase task states or roles to a v1.0 client.
- Streaming raw `TaskStatusUpdateEvent`/`TaskArtifactUpdateEvent` objects rather
  than v1.0 `StreamResponse` payloads.
- Implementing `SendMessage` as fire-and-forget while still advertising task
  polling/subscription without persisted task state.
- Making private agent metadata discoverable anonymously.
- Updating the server side but leaving `A2AClient` and `A2AAgentProvider` on
  legacy method names.
