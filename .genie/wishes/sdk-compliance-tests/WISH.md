# Wish: SDK Compliance Test Suite (Capability-Method Consistency)

| Field | Value |
|-------|-------|
| **Status** | PLANNED |
| **Slug** | `sdk-compliance-tests` |
| **Date** | 2026-03-11 |
| **Issue** | #82 |
| **Blocked by** | None (blockers #81, #85, #86 are orthogonal to this scope) |

---

## Summary

Enhance the existing runtime validator (`packages/channel-sdk/src/discovery/validator.ts`) to enforce capability-method consistency — "if you declare `canStreamResponse=true`, you must implement `createStreamSender()`". Then add a single parameterized test that loads all 6 channel plugins and runs validation + capability-method assertions on each.

This targets the ONE compliance gap not caught by TypeScript (optional interface methods aren't enforced at runtime) or the existing runtime validator (which checks required methods only).

## Scope

### IN
- Enhance `validatePluginInterface()` with capability-method pairing rules
- Parameterized test covering all 6 channels (WhatsApp, Telegram, Discord, Slack, A2A, Internal)
- Test runs `validatePluginInterface()` on each plugin + capability-method consistency assertions
- CI integration: picked up by existing `make test` glob

### OUT
- Source-level grep tests (fragile, weak signal — TypeScript catches import issues)
- Journey timing compliance (already consistent across channels)
- Reliability utility usage audit (TypeScript imports enforce this)
- `todo()` stubs for #81/#85/#86 (these blockers are separate concerns)
- Structural class hierarchy tests (BaseChannelPlugin inheritance is enforced by TypeScript)
- Distributed per-channel compliance tests
- Runtime compliance validation at plugin init time (future enhancement)

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Test location | `packages/channel-sdk/src/__tests__/compliance.test.ts` | SDK owns the contract definition |
| Validator enhancement | Add capability-method pairing to `validatePluginInterface()` | Runtime enforcement, not just test-time |
| Channel scope | All 6 plugins (whatsapp, telegram, discord, slack, a2a, internal) | Complete coverage including newer channels |
| Parameterization | `describe.each()` over channel plugin descriptors | Bun test native; each channel gets same battery |
| Optional capabilities | Skip assertion (not fail) when capability=false | Compliance = consistency, not completeness |

## Capability-Method Pairing Rules

These are the capability flags that imply a method must exist:

| Capability Flag | Required Method | Notes |
|----------------|----------------|-------|
| `canStreamResponse=true` | `createStreamSender` | Optional interface method — TypeScript won't catch missing impl |
| `canSendTyping=true` | `sendTyping` | Same pattern — optional method |
| `canReceiveReadReceipts=true` | `markAsRead` | Optional method |
The `react()` method is NOT governed by `canSendReaction` — that capability controls reaction sending via `sendMessage()`. The `react()` method is for per-thread ack reactions (media processing feedback) and has no corresponding capability flag, so it is excluded from pairing rules.

The `fetchHistory` method is independent of capabilities — it's checked by verifying the method exists on plugins that declare it (all 6 currently implement it).

## Success Criteria

- [ ] `validatePluginInterface()` validates capability-method pairings and returns errors for mismatches
- [ ] Test file at `packages/channel-sdk/src/__tests__/compliance.test.ts`
- [ ] Runs against all 6 channels: WhatsApp, Telegram, Discord, Slack, A2A, Internal
- [ ] Each plugin passes `validatePluginInterface()` (required methods + properties)
- [ ] Capability-method consistency verified: `canStreamResponse=true` → `createStreamSender` exists
- [ ] Capability-method consistency verified: `canSendTyping=true` → `sendTyping` exists
- [ ] Capability-method consistency verified: `canReceiveReadReceipts=true` → `markAsRead` exists
- [ ] `fetchHistory` presence verified on plugins that implement it
- [ ] `make check` passes (typecheck + lint + dead-code + test)
- [ ] No new dependencies added

## Assumptions & Risks

| Risk | Mitigation |
|------|-----------|
| Importing all 6 plugin classes pulls heavy deps | Tests only import the class, never instantiate; mock external deps if needed |
| Channel plugins have top-level side effects on import | Use `await import()` in test setup |
| New channels added later | Test descriptors are a simple array — add new entries trivially |
| Validator change could break existing callers | Additive only — new errors don't affect plugins that are correctly implemented |

---

## Execution Groups

### Group 1: Enhance `validatePluginInterface()` with Capability-Method Pairing

**Goal:** Add capability-method consistency validation to the existing runtime validator.

**Key file:** `packages/channel-sdk/src/discovery/validator.ts`

**Deliverables:**
- [ ] New `validateCapabilityMethods()` helper function that checks:
  - `canStreamResponse=true` → `createStreamSender` is a function
  - `canSendTyping=true` → `sendTyping` is a function
  - `canReceiveReadReceipts=true` → `markAsRead` is a function
- [ ] Integrate into `validatePluginInterface()` — call after existing method checks
- [ ] Errors are additive (existing validation unchanged)
- [ ] Export the capability-method pairing map for test reuse

**Acceptance:**
- Existing tests/callers unaffected (no false positives on correct plugins)
- A plugin declaring `canStreamResponse=true` without `createStreamSender` gets a validation error
- TypeScript compiles cleanly

**Validation:**
```bash
cd packages/channel-sdk && bun build src/discovery/validator.ts --no-bundle 2>&1 | head -5
```

---

### Group 2: Parameterized Compliance Test

**Goal:** Single test file that loads all 6 channel plugins and verifies each passes `validatePluginInterface()` plus capability-method consistency assertions.

**Depends on:** Group 1

**Key file:** `packages/channel-sdk/src/__tests__/compliance.test.ts`

**Deliverables:**
- [ ] Channel descriptor array for all 6 plugins:
  ```typescript
  const channels = [
    { name: 'whatsapp', import: () => import('@omni/channel-whatsapp').then(m => m.WhatsAppPlugin) },
    { name: 'telegram', import: () => import('@omni/channel-telegram').then(m => m.TelegramPlugin) },
    { name: 'discord',  import: () => import('@omni/channel-discord').then(m => m.DiscordPlugin) },
    { name: 'slack',    import: () => import('@omni/channel-slack').then(m => m.SlackPlugin) },
    { name: 'a2a',      import: () => import('@omni/channel-a2a').then(m => m.A2AChannelPlugin) },
    { name: 'internal', import: () => import('@omni/channel-internal').then(m => m.InternalChannelPlugin) },
  ];
  ```
- [ ] `describe.each(channels)` wrapper running:
  1. `validatePluginInterface()` passes (zero errors)
  2. Capability-method consistency: for each pairing in the map, if capability is true, method exists
  3. `fetchHistory` method exists (if plugin implements it)
- [ ] JSDoc header explaining what compliance means and how to add new channels

**Acceptance:**
- All 6 channels pass all assertions
- Tests run in <2s total (no instantiation, reflection only)
- `make check` passes

**Validation:**
```bash
cd packages/channel-sdk && bun test src/__tests__/compliance.test.ts
make check 2>&1 | tail -10
```

---

## Dependencies

```
Group 1 (validator enhancement) ← independent, start first
Group 2 (parameterized test) ← depends on Group 1
```

---

## Council Review Summary (Round 2)

**Vote: 0 APPROVE, 2 MODIFY, 4 REJECT** — Council recommended radical scope reduction:

1. **All 4 original channels already consistent** (4/4 on every dimension) — most tests would be green-on-arrival
2. **Runtime validator already exists** — enhance it rather than building parallel test infrastructure
3. **Source-level grep tests are fragile** — dropped entirely
4. **Blockers #81/#85/#86 still open** — dropped todo stubs (they belong in those wishes)
5. **Focus on the ONE gap**: capability-method consistency not caught by TypeScript or the existing validator
6. **Expand channel coverage**: include a2a + internal (6 channels, not 4)
