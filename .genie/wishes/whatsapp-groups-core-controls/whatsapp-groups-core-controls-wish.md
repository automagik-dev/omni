# WISH: WhatsApp Groups Core Controls

> Add core WhatsApp group lifecycle operations (create, inspect, membership, and leave) via API, SDK, CLI, and events.

**Status:** DRAFT
**Created:** 2026-02-07
**Author:** WISH Agent
**Beads:** omni-j5h

## Discovery

### What frustration/opportunity led here?
- Group listing already exists, but there is no way to create or control WhatsApp groups from Omni.
- This blocks operational workflows that need agent-managed group orchestration.

### What problem are we solving?
- Missing core group lifecycle controls in Omni’s channel-agnostic architecture.
- Need production-grade API + CLI controls with proper eventing and validation.

### What exists today? What’s broken?
- `GET /api/v2/instances/:id/groups` exists.
- No create/group-management endpoints.
- No SDK/CLI methods for group creation or membership management.
- WhatsApp plugin can fetch groups but does not expose active controls.

### Who benefits?
- Operators managing customer/support/project groups.
- Agent workflows requiring controlled group setup.
- CLI users who need full parity with API/SDK.

### How will we know it worked?
- Core group lifecycle actions can be executed through API + CLI + SDK.
- WhatsApp plugin performs operations with validated normalization.
- Group events are emitted and queryable.

## Alignment

**ASM-1:** Core wish covers only foundational lifecycle controls, not admin governance toggles.

**ASM-2:** Participant input can be phone numbers (`+5511...`/`5511...`) or valid WhatsApp JIDs; system normalizes before provider calls.

**DEC-1:** Group operations are added as optional channel capabilities in channel-sdk (method-presence + capability flags).

**DEC-2:** Endpoint family stays under instance scope (`/instances/:id/groups/...`) for consistency with existing Omni shape.

**DEC-3:** Event model introduces additive group events (`group.created`, `group.member_added`, `group.member_removed`, `group.left`, `group.operation_failed`) with no breaking changes.

**RISK-1:** Partial participant add/remove outcomes vary by provider behavior.
- **Mitigation:** Standardized per-participant result arrays with `status`, `code`, `message`.

**RISK-2:** Phone normalization edge cases (country code/plus formatting).
- **Mitigation:** Centralized normalization utility + Zod validation + explicit error details.

**RISK-3:** Capability drift between plugin methods and declared flags.
- **Mitigation:** tests for capability declaration + method availability expectations.

## Scope

### IN SCOPE
- `POST /instances/:id/groups` create group.
- `GET /instances/:id/groups/:groupId` fetch group metadata.
- `POST /instances/:id/groups/:groupId/participants:add` add members.
- `POST /instances/:id/groups/:groupId/participants:remove` remove members.
- `POST /instances/:id/groups/:groupId/leave` leave group.
- Channel SDK optional interfaces for core group controls.
- WhatsApp Baileys plugin implementation for core controls.
- SDK regeneration and new strongly-typed client methods.
- CLI commands under `omni instances groups ...` for core operations.
- Group core events and payload schemas.

### OUT OF SCOPE
- Admin governance toggles (announce/lock/promote/demote/approval/ephemeral).
- Invite code lifecycle and V4 invite operations.
- Bulk migration/backfill of historical group operations.
- UI dashboard implementation.

## Impact Analysis

### Packages Affected
| Package | Changes | Notes |
|---------|---------|-------|
| core | [x] events, [x] schemas, [x] types | Add group event types/payload typing |
| db | [ ] schema, [ ] migrations | No DB schema changes required for v1 |
| api | [x] routes, [x] openapi, [x] validation | New group control endpoints |
| sdk | [x] regenerate, [x] client methods | New `instances.*group*` methods |
| cli | [x] commands | `instances groups` subcommands |
| channel-sdk | [x] interface, [x] capabilities | Optional group control capabilities |
| channel-whatsapp | [x] implementation | Baileys core group operations |

### System Checklist
- [ ] **Events**: Add core group event types and payload contracts
- [ ] **Database**: No schema change needed
- [ ] **SDK**: Regenerate after OpenAPI updates
- [ ] **CLI**: Add/update commands for new SDK methods
- [ ] **Tests**: API + plugin + SDK coverage + CLI command tests

## Execution Group A: Contracts & Core Endpoint Surface

**Goal:** Establish API + schema + SDK contracts for core group lifecycle.

**Packages:** core, api, sdk, channel-sdk

**Deliverables:**
- [ ] Add channel-sdk optional methods for core group controls.
- [ ] Add capability flags for core group operations.
- [ ] Add Zod request/response schemas for core group endpoints.
- [ ] Add OpenAPI path registrations for new routes.
- [ ] Add SDK types and client methods for core group controls.

**Acceptance Criteria:**
- [ ] OpenAPI includes all core endpoints with examples.
- [ ] SDK exposes typed methods for create/get/add/remove/leave.
- [ ] Backward compatibility maintained (all new methods optional at plugin level).

**Validation:**
- `make typecheck`
- `make lint`
- `make sdk-generate`
- `bun test packages/sdk/src/__tests__/sdk-coverage.test.ts`

## Execution Group B: WhatsApp Plugin Core Implementation + Events

**Goal:** Implement Baileys-backed core operations with normalization and event emission.

**Packages:** channel-whatsapp, channel-sdk, core

**Deliverables:**
- [ ] Implement create group using `sock.groupCreate(subject, participantsJids)`.
- [ ] Implement metadata fetch, add/remove participants, and leave group.
- [ ] Add participant normalization/JID conversion pipeline.
- [ ] Emit standardized group core events (success/failure paths).
- [ ] Map provider-level responses into Omni canonical result shape.

**Acceptance Criteria:**
- [ ] Core operations execute against connected WhatsApp instance.
- [ ] Mixed participant outcomes are returned with per-entry statuses.
- [ ] Events are emitted for all successful and failed core operations.

**Validation:**
- `make typecheck`
- `bun test packages/channel-whatsapp`
- `make test-api`

## Execution Group C: CLI UX + End-to-End Core Flows

**Goal:** Deliver operator-grade CLI commands and verify full path API→plugin→events.

**Packages:** cli, sdk, api

**Deliverables:**
- [ ] Extend `omni instances groups` with core control subcommands.
- [ ] Add parsing for repeated `--participant` and CSV fallback.
- [ ] Add user-friendly and JSON output modes for operation results.
- [ ] Update SDK coverage map and CLI tests.
- [ ] Add end-to-end smoke test scripts/examples.

**Acceptance Criteria:**
- [ ] Operators can create/manage/leave groups from CLI.
- [ ] CLI outputs per-participant failures clearly.
- [ ] SDK coverage test remains green.

**Validation:**
- `make typecheck`
- `bun test packages/cli`
- `make check`

## API Surface (Core)

- `POST /api/v2/instances/:id/groups`
- `GET /api/v2/instances/:id/groups/:groupId`
- `POST /api/v2/instances/:id/groups/:groupId/participants:add`
- `POST /api/v2/instances/:id/groups/:groupId/participants:remove`
- `POST /api/v2/instances/:id/groups/:groupId/leave`

## CLI Surface (Core)

- `omni instances groups create <instanceId> --subject "..." --participant <p> [--participant <p>...]`
- `omni instances groups get <instanceId> <groupId>`
- `omni instances groups add <instanceId> <groupId> --participant <p>...`
- `omni instances groups remove <instanceId> <groupId> --participant <p>...`
- `omni instances groups leave <instanceId> <groupId>`

## Success Metrics

- Core group lifecycle parity available in API, SDK, and CLI.
- 0 breaking changes for existing channels/plugins.
- Deterministic validation and normalized participant handling.
- Clear observability via emitted group core events.
