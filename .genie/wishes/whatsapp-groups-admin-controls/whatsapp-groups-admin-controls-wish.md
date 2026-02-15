# WISH: WhatsApp Groups Admin Controls

> Add advanced group governance operations (subject/description/settings/admin moderation/approval/ephemeral) for WhatsApp groups.

**Status:** DRAFT
**Created:** 2026-02-07
**Author:** WISH Agent
**Beads:** omni-b29
**Depends On:** omni-j5h (whatsapp-groups-core-controls)

## Discovery

### What frustration/opportunity led here?
- Creating groups alone is insufficient for real operations.
- Teams need to moderate and govern groups directly from Omni.

### What problem are we solving?
- Missing admin control plane for WhatsApp groups despite Baileys support.
- Need API/CLI primitives for policy and moderation operations.

### What exists today? What’s broken?
- No admin-level endpoints in Omni for group policies.
- No promote/demote/settings/approval controls in SDK/CLI.

### Who benefits?
- Ops/admin teams enforcing group policy.
- Agent workflows with moderator responsibilities.

### How will we know it worked?
- Admin policy toggles and moderation commands run through API/CLI with typed SDK support.
- Outcomes are observable via structured events.

## Alignment

**ASM-1:** Core lifecycle endpoints from omni-j5h are already available.

**ASM-2:** Provider permissions and WhatsApp-side constraints can reject actions; Omni returns structured failures without hiding provider semantics.

**DEC-1:** Admin controls remain channel-optional; unsupported plugins return `NOT_SUPPORTED`.

**DEC-2:** Endpoint strategy remains instance/group scoped for discoverability and auth scoping consistency.

**DEC-3:** Admin events are additive and namespaced by operation intent (`group.settings_updated`, `group.admins_updated`, `group.join_requests_updated`, etc.).

**RISK-1:** Permission errors are common in admin operations.
- **Mitigation:** explicit error taxonomy (`INSUFFICIENT_PERMISSIONS`, `GROUP_NOT_FOUND`, `INVALID_OPERATION`).

**RISK-2:** Setting updates can conflict if multiple operators act concurrently.
- **Mitigation:** operation-level idempotency notes + event timestamps + latest-state fetch guidance.

**RISK-3:** Approval flows may return partial updates for batch requests.
- **Mitigation:** per-request result vectors and no lossy aggregation.

## Scope

### IN SCOPE
- Update subject.
- Update/clear description.
- Toggle announcement mode.
- Toggle locked/unlocked settings mode.
- Update member-add mode (admin-only vs all members).
- Toggle join-approval mode.
- List pending join requests.
- Approve/reject join requests.
- Promote/demote admins.
- Toggle ephemeral/disappearing mode.
- SDK + CLI + events for these operations.

### OUT OF SCOPE
- Invite code lifecycle and V4 invite handling.
- Group creation/membership basics (handled in core wish).
- UI screens for admin operations.

## Impact Analysis

### Packages Affected
| Package | Changes | Notes |
|---------|---------|-------|
| core | [x] events, [x] schemas | Admin operation event contracts |
| db | [ ] schema, [ ] migrations | No schema changes needed |
| api | [x] routes, [x] openapi, [x] validation | Admin operation endpoints |
| sdk | [x] regenerate, [x] methods | Typed admin control methods |
| cli | [x] commands | Admin subcommands under instances groups |
| channel-sdk | [x] interface/capabilities | Optional admin control methods |
| channel-whatsapp | [x] implementation | Baileys admin control bindings |

### System Checklist
- [ ] **Events**: Add admin control event types/payloads
- [ ] **Database**: No schema changes
- [ ] **SDK**: Regenerate and update coverage map
- [ ] **CLI**: Add admin command set
- [ ] **Tests**: API/plugin/CLI behavior and error taxonomy

## Execution Group A: Admin Contracts + Endpoint Model

**Goal:** Define and expose admin control contract across API/OpenAPI/SDK.

**Packages:** core, api, sdk, channel-sdk

**Deliverables:**
- [ ] Add channel-sdk optional admin methods + capability flags.
- [ ] Add request/response Zod schemas for each admin operation.
- [ ] Register OpenAPI paths and reusable schemas.
- [ ] Regenerate SDK and add typed methods.

**Acceptance Criteria:**
- [ ] All admin operations appear in OpenAPI and SDK.
- [ ] Unsupported channels fail with consistent `NOT_SUPPORTED` shape.
- [ ] Input validation catches invalid mode toggles/actions.

**Validation:**
- `make typecheck`
- `make sdk-generate`
- `bun test packages/sdk/src/__tests__/sdk-coverage.test.ts`

## Execution Group B: WhatsApp Plugin Admin Implementation

**Goal:** Wire Baileys admin/group-policy methods to channel plugin interface.

**Packages:** channel-whatsapp, channel-sdk, core

**Deliverables:**
- [ ] Implement policy update calls (`groupSettingUpdate`, `groupMemberAddMode`, `groupJoinApprovalMode`, `groupToggleEphemeral`).
- [ ] Implement promote/demote + join request list/update.
- [ ] Implement subject/description updates.
- [ ] Normalize provider response/errors into Omni canonical shapes.
- [ ] Emit admin operation events (success/failure).

**Acceptance Criteria:**
- [ ] All in-scope operations execute on connected WhatsApp instance with appropriate permissions.
- [ ] Partial outcomes return per-entity result vectors.
- [ ] Events contain operation type, actor context, and outcome summary.

**Validation:**
- `make typecheck`
- `bun test packages/channel-whatsapp`
- `make test-api`

## Execution Group C: CLI Admin UX + Operational Guardrails

**Goal:** Expose admin controls in CLI with safe/clear UX.

**Packages:** cli, sdk

**Deliverables:**
- [ ] Add admin operation subcommands and option parsing.
- [ ] Add explicit confirmation prompts for destructive actions where appropriate.
- [ ] Add structured JSON output for automation use.
- [ ] Update SDK coverage mapping/tests.

**Acceptance Criteria:**
- [ ] Admin flows are scriptable and human-friendly.
- [ ] Errors surface actionable reason codes.
- [ ] CLI/SDK parity maintained.

**Validation:**
- `bun test packages/cli`
- `make typecheck`
- `make check`

## API Surface (Admin)

- `PATCH /api/v2/instances/:id/groups/:groupId/subject`
- `PATCH /api/v2/instances/:id/groups/:groupId/description`
- `POST /api/v2/instances/:id/groups/:groupId/settings`
- `POST /api/v2/instances/:id/groups/:groupId/admins:promote`
- `POST /api/v2/instances/:id/groups/:groupId/admins:demote`
- `GET /api/v2/instances/:id/groups/:groupId/join-requests`
- `POST /api/v2/instances/:id/groups/:groupId/join-requests:update`
- `POST /api/v2/instances/:id/groups/:groupId/ephemeral`

## CLI Surface (Admin)

- `omni instances groups set-subject <instanceId> <groupId> --subject "..."`
- `omni instances groups set-description <instanceId> <groupId> --description "..." [--clear]`
- `omni instances groups settings <instanceId> <groupId> --announcement on|off --locked on|off --member-add admin|all --join-approval on|off`
- `omni instances groups promote <instanceId> <groupId> --participant <p>...`
- `omni instances groups demote <instanceId> <groupId> --participant <p>...`
- `omni instances groups join-requests <instanceId> <groupId>`
- `omni instances groups approve <instanceId> <groupId> --participant <p>...`
- `omni instances groups reject <instanceId> <groupId> --participant <p>...`
- `omni instances groups ephemeral <instanceId> <groupId> --seconds <n|0>`

## Success Metrics

- Complete admin controls parity (excluding invite lifecycle) for WhatsApp in API/SDK/CLI.
- Actionable and consistent error contracts.
- Observable moderation operations through events.
