# WISH: WhatsApp Groups Full Parity

> Complete advanced invite/join parity (including V4 invite operations) and finalize comprehensive WhatsApp group control coverage.

**Status:** DRAFT
**Created:** 2026-02-07
**Author:** WISH Agent
**Beads:** omni-f99
**Depends On:** omni-j5h, omni-b29

## Discovery

### What frustration/opportunity led here?
- User requested full advanced control: “use every feature Baileys allow for advanced group control.”
- Remaining gap after core+admin is advanced invite lifecycle and V4 flows.

### What problem are we solving?
- Final parity layer for all practical Baileys group capabilities.
- Ensure Omni can orchestrate invite-based group operations end-to-end.

### What exists today? What’s broken?
- No invite code management/join-by-code endpoints.
- No V4 invite accept/revoke support.
- No consolidated parity contract proving feature completeness.

### Who benefits?
- Power operators and automation systems integrating external invite flows.
- Teams that need deterministic scriptable group onboarding controls.

### How will we know it worked?
- Invite lifecycle and V4 flows are available through API+SDK+CLI.
- Parity checklist against Baileys group API is complete and tested.

## Alignment

**ASM-1:** Core and admin wishes are landed before this wish executes.

**ASM-2:** V4 invite operations may require message-key/message-payload artifacts not always available in normal CLI contexts.

**DEC-1:** V4 operations are included but clearly marked as advanced expert endpoints/commands.

**DEC-2:** Invite lifecycle operations use explicit operation names and payload schemas to prevent ambiguity.

**DEC-3:** Add “parity manifest” test/documentation to enforce long-term completeness.

**RISK-1:** V4 invite payload handling complexity can increase error rate.
- **Mitigation:** strict schema validation + typed helper wrappers + explicit examples.

**RISK-2:** Misuse of invite revoke operations may disrupt live onboarding.
- **Mitigation:** CLI confirmation and verbose dry-run preview where possible.

**RISK-3:** Future Baileys API changes can silently reduce parity.
- **Mitigation:** parity test matrix and CI assertions tied to documented capability map.

## Scope

### IN SCOPE
- Get invite code.
- Revoke/regenerate invite code.
- Join group by invite code.
- Get invite info by code.
- Revoke invite V4 for specific invited participant.
- Accept invite V4 with required key/message payload.
- SDK + CLI + event support for invite/V4 operations.
- Parity matrix and tests validating full-group-control coverage.

### OUT OF SCOPE
- New UI for invite management.
- Non-WhatsApp channel implementations.
- Experimental/non-documented provider behavior not in Baileys stable surface.

## Impact Analysis

### Packages Affected
| Package | Changes | Notes |
|---------|---------|-------|
| core | [x] events, [x] schemas | Invite/V4 event contracts |
| db | [ ] schema, [ ] migrations | No schema changes required |
| api | [x] routes, [x] openapi | Invite/V4 endpoints |
| sdk | [x] regenerate, [x] methods | Invite/V4 methods and types |
| cli | [x] commands | Advanced invite command set |
| channel-sdk | [x] optional methods/capabilities | Invite/V4 optional controls |
| channel-whatsapp | [x] implementation | Baileys invite/V4 bindings |
| docs | [x] parity matrix | Explicit feature-completeness mapping |

### System Checklist
- [ ] **Events**: Add invite/V4 success/failure events
- [ ] **Database**: No DB changes
- [ ] **SDK**: Regenerate + verify coverage
- [ ] **CLI**: Add advanced invite commands
- [ ] **Tests**: parity matrix tests + E2E smoke paths

## Execution Group A: Invite/V4 Contracts + API/SDK Surface

**Goal:** Define strict endpoint/model contracts for invite and V4 operations.

**Packages:** core, api, sdk, channel-sdk

**Deliverables:**
- [ ] Add optional invite/V4 methods and capability flags in channel-sdk.
- [ ] Add Zod schemas + OpenAPI registration for invite/V4 endpoints.
- [ ] Add SDK typed methods and models.
- [ ] Add canonical response/error shapes for code-based operations.

**Acceptance Criteria:**
- [ ] Endpoint contracts are explicit and documented with examples.
- [ ] SDK exposes all invite/V4 methods.
- [ ] Validation rejects malformed V4 payload/key inputs.

**Validation:**
- `make typecheck`
- `make sdk-generate`
- `bun test packages/sdk/src/__tests__/sdk-coverage.test.ts`

## Execution Group B: WhatsApp Invite/V4 Implementation + Events

**Goal:** Implement provider bindings and robust eventing for advanced invite flows.

**Packages:** channel-whatsapp, core

**Deliverables:**
- [ ] Implement `groupInviteCode`, `groupRevokeInvite`, `groupAcceptInvite`, `groupGetInviteInfo`.
- [ ] Implement `groupRevokeInviteV4`, `groupAcceptInviteV4`.
- [ ] Add canonical mapping for provider outcomes and edge errors.
- [ ] Emit invite/V4 events for success/failure.

**Acceptance Criteria:**
- [ ] Invite lifecycle operations execute end-to-end.
- [ ] V4 operations execute when valid payload artifacts are supplied.
- [ ] Event payloads include operation context and outcomes.

**Validation:**
- `make typecheck`
- `bun test packages/channel-whatsapp`
- `make test-api`

## Execution Group C: CLI Expert Flows + Parity Guardrails

**Goal:** Deliver advanced CLI operations and enforce long-term full parity.

**Packages:** cli, sdk, docs

**Deliverables:**
- [ ] Add invite/v4 CLI subcommands with clear option docs and warnings.
- [ ] Add JSON-first output mode for automation pipelines.
- [ ] Add parity matrix document and automated parity verification tests.
- [ ] Ensure SDK-coverage map includes new methods.

**Acceptance Criteria:**
- [ ] CLI can run all invite lifecycle operations.
- [ ] V4 commands are available and clearly documented as advanced.
- [ ] Parity tests fail if any documented capability becomes unmapped.

**Validation:**
- `bun test packages/cli`
- `bun test packages/sdk/src/__tests__/sdk-coverage.test.ts`
- `make check`

## API Surface (Full Parity Layer)

- `GET /api/v2/instances/:id/groups/:groupId/invite-code`
- `POST /api/v2/instances/:id/groups/:groupId/invite-code:revoke`
- `POST /api/v2/instances/:id/groups:accept-invite`
- `GET /api/v2/instances/:id/groups/invite-info/:code`
- `POST /api/v2/instances/:id/groups/:groupId/invite-v4:revoke`
- `POST /api/v2/instances/:id/groups/invite-v4:accept`

## CLI Surface (Full Parity Layer)

- `omni instances groups invite-code <instanceId> <groupId>`
- `omni instances groups revoke-invite <instanceId> <groupId>`
- `omni instances groups join-by-code <instanceId> --code <inviteCode>`
- `omni instances groups invite-info <instanceId> --code <inviteCode>`
- `omni instances groups revoke-invite-v4 <instanceId> <groupId> --participant <jid>`
- `omni instances groups accept-invite-v4 <instanceId> --key '<json>' --message '<json>'`

## Success Metrics

- All targeted Baileys group controls mapped to Omni API/SDK/CLI.
- Advanced invite/V4 operations work with strict validation and clear UX.
- Parity guardrails prevent future regression in group capability coverage.
