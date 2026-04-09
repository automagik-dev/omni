# Wish: Fix Automation Pairing Pipeline (end-to-end)

| Field | Value |
|-------|-------|
| **Status** | APPROVED |
| **Slug** | `fix-automation-pairing` |
| **Date** | 2026-03-31 |
| **Design** | [DESIGN.md](../../brainstorms/fix-automation-pairing/DESIGN.md) |
| **Issues** | automagik-dev/omni#322, automagik-dev/omni#323, automagik-dev/omni#324 |

## Summary

The automation engine's pairing flow is broken end-to-end: events lack NATS-routable metadata, the engine starts without the `sendMessage` dependency, and no event fires on pairing approval. This wish delivers three surgical fixes that restore the full pairing automation pipeline — from request to approval to notification.

## Scope

### IN
- Fix `requestPairing()` to publish events with `{ channelType, instanceId }` metadata so NATS subjects match subscription patterns
- Wire `sendMessage` dependency into `startEngine()` using the channel plugin registry
- Add `access.pairing_approved` event type and emit it from `approvePairingRequest()`
- Update callers to pass `channelType` through options
- Tests for all three fixes

### OUT
- No `access.pairing_denied` event (follow-up if needed)
- No automation UI/CLI changes
- No changes to automation rule schema or engine core
- No new CLI commands

## Decisions

| Decision | Rationale |
|----------|-----------|
| Pass `channelType` via `requestPairing(options)` | Both callers (`agent-dispatcher.ts:3457`, `agent-responder.ts:569`) already have the instance object with `instance.channel` — avoids extra DB query |
| Single PR for all 3 fixes | They form one functional flow; testing one without the others is meaningless |
| Use `getPlugin(channel)` from `loader.ts` for `sendMessage` dep | `getPlugin(id)` takes a channel type string (e.g. `'whatsapp-baileys'`), so the wrapper must first resolve instanceId→channel via DB, then call `getPlugin(channel)` |
| `approvePairingRequest` must query instance for channel | The function only receives `requestId` + `instanceId` — must look up `instances` table to get `channel` for event metadata |
| Add `pairing_approved` but not `pairing_denied` | Approval is the user-facing event; denial is already logged in metadata |
| No stream config changes needed | `access.>` wildcard in `streams.ts` already covers `access.pairing_approved` |

## Success Criteria

- [ ] `access.pairing_requested` events publish with NATS subject `access.pairing_requested.<channelType>.<instanceId>`
- [ ] Automations matching `access.pairing_requested` trigger correctly
- [ ] `send_message` actions in automations deliver messages via the channel plugin
- [ ] `access.pairing_approved` event fires when a pairing request is approved
- [ ] Existing pairing tests pass + new tests for event metadata and sendMessage wiring
- [ ] `bun test` passes across all packages

## Execution Strategy

### Wave 1 (parallel)
| Group | Agent | Description |
|-------|-------|-------------|
| 1 | engineer | Fix event metadata + add pairing_approved event type |
| 2 | engineer | Wire sendMessage dependency into startEngine() |

### Wave 2 (after Wave 1)
| Group | Agent | Description |
|-------|-------|-------------|
| 3 | engineer | Update callers + integration tests |
| review | reviewer | Review all groups |

## Execution Groups

### Group 1: Event metadata + pairing_approved type

**Goal:** Fix bare NATS subjects and add the missing event type.

**Deliverables:**
1. In `packages/core/src/events/types.ts`: add `'access.pairing_approved'` to `CORE_EVENT_TYPES`, add `AccessPairingApprovedPayload` type with fields `{ instanceId, platformUserId, requestId, ruleId }`, add to `EventPayloadMap`
2. In `packages/api/src/services/access.ts`: add `channelType?: string` to `requestPairing()` options, pass `{ instanceId, channelType }` as third arg to `eventBus.publish()` at line 334
3. In `packages/api/src/services/access.ts`: emit `access.pairing_approved` event in `approvePairingRequest()` after cache clear (line 459), with `{ instanceId, channelType }` metadata. **NOTE**: `approvePairingRequest(requestId, instanceId)` does NOT have `channelType` — must either add it as a third parameter, or query the `instances` table inside the method to resolve `channel`. Prefer adding `channelType` as an optional parameter since the HTTP handler calling this can look it up

**Acceptance Criteria:**
- [ ] `CORE_EVENT_TYPES` includes `'access.pairing_approved'`
- [ ] `requestPairing()` accepts `channelType` in options and passes metadata to publish
- [ ] `approvePairingRequest()` emits `access.pairing_approved` with metadata
- [ ] TypeScript compiles without errors

**Validation:**
```bash
cd /home/genie/workspace/repos/omni && bun run build 2>&1 | tail -5
```

**depends-on:** none

---

### Group 2: Wire sendMessage into startEngine()

**Goal:** Inject the `sendMessage` function so `send_message` automation actions work.

**Deliverables:**
1. In `packages/api/src/index.ts` (~line 297): replace `startEngine({})` with a call that passes `sendMessage`. **IMPORTANT**: `getPlugin(id)` in `loader.ts` takes a channel type string (e.g. `'whatsapp-baileys'`), NOT an instanceId. The wrapper must first resolve the instance's channel type:
   ```ts
   await services.automations.startEngine({
     sendMessage: async (instanceId, to, content) => {
       // Look up instance to get channel type
       const instance = await services.instances.getById(instanceId);
       if (!instance) throw new Error(`Instance not found: ${instanceId}`);
       const plugin = await getPlugin(instance.channel);
       if (!plugin) throw new Error(`No plugin for channel: ${instance.channel}`);
       await plugin.sendMessage(instanceId, { type: 'text', chatId: to, content });
     },
   });
   ```
2. Import `getPlugin` from `./plugins/loader` in index.ts
3. Verify the `sendMessage` signature in `automations.ts:50` matches what the engine expects

**Acceptance Criteria:**
- [ ] `startEngine()` receives a working `sendMessage` function
- [ ] The function resolves the correct channel plugin for the instance
- [ ] TypeScript compiles without errors

**Validation:**
```bash
cd /home/genie/workspace/repos/omni && bun run build 2>&1 | tail -5
```

**depends-on:** none

---

### Group 3: Update callers + tests

**Goal:** Thread `channelType` from callers into `requestPairing()` and add integration tests.

**Deliverables:**
1. In `packages/api/src/plugins/agent-dispatcher.ts:3457`: pass `{ channelType: instance.channel }` as option to `requestPairing()` (field is `instance.channel`, not `channelType`)
2. In `packages/api/src/plugins/agent-responder.ts:569`: same — pass `{ channelType: instance.channel }` from the instance context
3. Add/update tests in `packages/api/src/__tests__/pairing.test.ts`:
   - Test that `requestPairing()` with `channelType` option publishes event with metadata
   - Test that `approvePairingRequest()` emits `access.pairing_approved`
4. Add test in `packages/core/src/automations/__tests__/` verifying `send_message` action succeeds when `sendMessage` dep is provided

**Acceptance Criteria:**
- [ ] Both callers pass `channelType` to `requestPairing()`
- [ ] Pairing test verifies event metadata includes `channelType` and `instanceId`
- [ ] Pairing test verifies `access.pairing_approved` emission
- [ ] Automation test verifies `send_message` action works with dep
- [ ] `bun test` passes across all packages

**Validation:**
```bash
cd /home/genie/workspace/repos/omni && bun test 2>&1 | tail -20
```

**depends-on:** Group 1, Group 2

---

## QA Criteria

- [ ] Create a test automation with trigger `access.pairing_requested` and action `send_message` — verify it fires when an unknown user messages the bot
- [ ] Verify `access.pairing_approved` event appears in `omni events list` after approving a pairing request
- [ ] Verify existing pairing flow (request, approve, deny) still works correctly
- [ ] Verify `bun test` passes with no regressions

---

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `channelType` not available at caller sites | Low | Verified both callers have `instance.channel` (field is `.channel` not `.channelType`) |
| `getPlugin()` needs channel type, not instanceId | Medium | `sendMessage` wrapper must first resolve instanceId→channel via `services.instances.getById()`, then call `getPlugin(channel)` |
| `approvePairingRequest()` lacks channelType | Medium | Must add `channelType` parameter or query instances table inside the method |
| `plugin.sendMessage()` signature mismatch | Low | All channel plugins implement the same `ChannelPlugin` interface |

---

## Files to Create/Modify

```
packages/core/src/events/types.ts                    # Add pairing_approved event type
packages/api/src/services/access.ts                   # Fix metadata + emit approved event
packages/api/src/index.ts                             # Wire sendMessage dep
packages/api/src/plugins/agent-dispatcher.ts           # Pass channelType to requestPairing
packages/api/src/plugins/agent-responder.ts            # Pass channelType to requestPairing
packages/api/src/__tests__/pairing.test.ts             # Test event metadata + approved emission
packages/core/src/automations/__tests__/engine-integration.test.ts  # Test sendMessage action
```
