---
id: omni/a2a
title: "A2A Interoperability"
kind: capability
domain: omni
capabilities:
  - a2a
tags:
  - a2a
  - protocol
  - interoperability
  - agent-discovery
applies_to:
  - packages/channel-a2a
  - packages/core/src/providers/a2a-client.ts
  - packages/core/src/providers/a2a-provider.ts
  - packages/api/src/app.ts
  - packages/api/src/routes/v2/agents.ts
  - packages/db/src/schema.ts
owners:
  - Luis Filipe
status: active
normative: true
---

# A2A Interoperability

## Intent

Make Omni agents discoverable and callable by external systems through the
official Agent2Agent protocol, while keeping Omni's event bus and dispatcher as
the internal execution model.

## Invariants

- A2A support MUST be evaluated against official A2A documentation, currently
  the `latest` v1.0 material at `https://a2a-protocol.org/latest/`.
- Omni MUST distinguish A2A server/channel behavior from A2A client/provider
  behavior.
- Omni MUST NOT advertise A2A protocol versions, bindings, operations,
  streaming modes, skills, media types, or authentication schemes that are not
  implemented and tested.
- Agent discovery MUST be backed by first-class Omni agent records and MUST NOT
  serve hardcoded placeholder cards for production use.
- Per-agent parameters MUST have a durable source of truth, either in
  `agents.agent_card`, `agents.metadata`, explicit schema fields, or a documented
  registry mapping. They MUST NOT live only in ad hoc code constants.
- Authentication and authorization MUST be part of A2A design before exposing
  private agent cards or callable endpoints beyond localhost.
- Backward compatibility with pre-1.0 A2A MAY exist only when the Agent Card
  explicitly declares a legacy interface separately from v1.0.

## Validation

- `omni channels list --json | jq '.[] | select(.channel == "a2a")'`
- `omni instances list --json | jq '[.[] | select(.channel == "a2a")]'`
- `omni providers list --json | jq '[.[] | select(.schema == "a2a")]'`
- `rg -n "message/send|message/stream|tasks/get|agent.json|TASK_STATE_|ROLE_USER|supportedInterfaces" packages/channel-a2a packages/core/src/providers packages/api/src`
- `cd /Users/luis/Dev/namastex/omni-v2 && bun test packages/channel-a2a packages/core/src/providers/__tests__/a2a-client.test.ts packages/api/src/__tests__/a2a-integration.test.ts`

## Known Failure Modes

- The A2A plugin is loaded but no A2A instance/provider is configured, causing
  code-level support to be mistaken for operational support.
- `A2A_ENABLED` is false, so `/a2a/*` and the legacy card endpoint return 503.
- Agent card discovery returns a static `"Omni Agent"` instead of a concrete
  Omni agent with its own parameters.
- The server accepts/returns v0.3-style JSON while the card claims v1.0.
- A client polls `GetTask` or subscribes to a task but Omni has no durable task
  store for A2A task state.
