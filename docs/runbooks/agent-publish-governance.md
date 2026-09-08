# Agent publish governance (RFC #925 G4c)

The `publishes` half of an agent's event manifest (`agents.event_manifest`,
see #985) is an **emission allowlist**: an agent-attributed `emit_event` may
only publish event types the agent declared. Per the RFC: *"Emission outside
the manifest → refused + DLQ."* Enforcement landed with #987.

## Semantics: absent vs empty `publishes`

| Stored state | Effect on agent-attributed emissions |
|---|---|
| No manifest (`event_manifest` is NULL) | **Ungoverned** — today's behavior, no flag day |
| Manifest **without** a `publishes` key | **Ungoverned** — the document never spoke about publishing |
| `publishes: []` | **Deny all** — the agent explicitly declared "publishes nothing" |
| `publishes: [{ event: ... }, ...]` | Only the exactly-declared types pass (no wildcard/prefix matching) |

Two consequences worth internalizing:

- **Applying any manifest opts the agent into publish governance.** The
  validated apply path (`PUT /api/v2/agents/:id/manifest`, `omni agents
  manifest apply`) parses with `AgentEventManifestSchema`, which defaults an
  omitted `publishes` to `[]`. A manifest that declares only `accepts`
  therefore stores `publishes: []` — deny-all. Declare what the agent emits,
  or don't apply a manifest at all. The "manifest without a `publishes` key"
  row is only reachable for jsonb written outside the validated path.
- **An empty allowlist is an allowlist.** `publishes: []` is an explicit
  declaration, not an absence.

The pure check lives in `@omni/core`
(`checkPublishAllowed`, `packages/core/src/schemas/agent-manifest.ts`).

## Order of checks at emission time

1. **Publish allowlist** (#987) — the type must be declared, or the emission
   is refused with reason `publish_not_declared`. Checked first: an
   undeclared type is refused before its payload is even examined.
2. **Schema registry** (#959) — a registered type's payload must satisfy its
   schema (`schema_validation_failed`); with
   `OMNI_STRICT_EMIT_EVENT_SCHEMAS=true` an unregistered type is refused as
   `schema_not_registered` (#1000).

## Refusal path (DLQ)

A refused emission publishes **nothing** and journals **nothing**. Its only
record is a `dead_letter_events` row whose `error` starts with the reason
token — `publish_not_declared` for allowlist refusals — with
`next_auto_retry_at` NULL (manual intervention only: retrying an unchanged
undeclared emission can never succeed; fix the manifest, then retry).

```bash
omni dead-letters list            # filter on error prefix publish_not_declared
omni dead-letters retry <id>      # after declaring the type in the manifest
```

## What is enforced today, and what awaits #986

Enforcement runs in the automation `emit_event` gate
(`validateEmitEvent` in `packages/api/src/plugins/automation-actions.ts`) and
activates when the executing automation carries a managing agent
(`context.automation.managedByAgentId`). Wiring status:

- **Compiled automations (#986)** — the G4b compiler stamps
  `managed_by_agent_id` on automations compiled from a manifest's `accepts`
  entries; the engine threads it into the emit path and enforcement is live
  for them the moment #986 lands. The seam is already in place
  (`Automation.managedByAgentId` → `TemplateContext.automation` →
  `validateEmitEvent`'s `emitterAgentId`).
- **Hand-authored automations** — no managing agent, ungoverned (unchanged).
- **`POST /events/trigger`** — currently ungoverned: API keys carry no agent
  identity, so there is no principal→agent mapping to enforce against. If
  agent-bound credentials ever exist, the trigger path should thread that
  agent id into the same gate.
- **Agent dispatcher runs** — agents deliver messages/lifecycle events via
  dedicated services and have no `emit_event` surface; nothing to gate.

Edge case: if the managing agent's row has been deleted, the emission
degrades to ungoverned (fail-open, consistent with the emit path's other
resolution reads).
