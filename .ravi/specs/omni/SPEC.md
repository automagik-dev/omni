---
id: omni
title: "Omni"
kind: domain
domain: omni
capabilities:
tags:
  - omni
  - messaging
  - agents
applies_to:
  - packages/api
  - packages/core
  - packages/db
  - packages/cli
  - packages/channel-*
owners:
  - Luis Filipe
status: active
normative: true
---

# Omni

## Intent

Protect Omni V2 as an event-driven omnichannel runtime where channels, dispatch,
providers, and external protocols remain explicit boundaries.

## Invariants

- Omni MUST treat local runtime state and production state as separate until a
  CLI/runtime command proves otherwise.
- Channel plugins MUST translate platform events into Omni events without
  coupling protocol-specific details into provider execution.
- The dispatcher MUST remain the central path for deciding whether, when, and
  how an agent is triggered.
- Provider implementations MUST be described by their schema and MUST NOT be
  confused with channel transport. Example: `nats-genie` is a provider path,
  not an Omni channel.
- External interoperability protocols MUST preserve enough routing context for
  async responses to return to the correct instance, chat, thread, task, or
  caller.
- Runtime claims MUST be validated through `omni` CLI or HTTP API before being
  stated as current state.

## Validation

- `git -C /Users/luis/Dev/namastex/omni-v2 status --short --branch`
- `omni status --json`
- `omni channels list --json`
- `omni instances list --json`
- `omni providers list --json`
- `omni agents list --json`
- `cd /Users/luis/Dev/namastex/omni-v2 && bun run typecheck`
- `cd /Users/luis/Dev/namastex/omni-v2 && bun run test`

## Known Failure Modes

- Reporting capability from code presence only, while the local runtime feature
  flag or instance/provider config is absent.
- Mixing channel responsibilities with provider responsibilities, especially in
  Omni <-> Genie or A2A work.
- Publishing protocol endpoints that return static or hardcoded agent metadata
  instead of real Omni agent state.
- Updating a protocol client without updating the matching server, tests, SDK,
  docs, and runtime checks.
