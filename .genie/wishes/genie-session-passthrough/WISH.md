# Wish: Pass --session to genie spawn for isolated tmux sessions

| Field | Value |
|-------|-------|
| **Status** | DRAFT |
| **Slug** | `genie-session-passthrough` |
| **Date** | 2026-03-21 |
| **Issue** | automagik-dev/omni#239 |

## Summary

Add `sessionName` support to the Genie provider so Omni can pass `--session <name>` to `genie spawn`. This groups all WhatsApp chat agents into a dedicated tmux session (e.g., `claudia-whatsapp`) instead of scattering them across whatever session the Omni API process happens to be in. Follows the same pattern as the `autoSpawnDir` passthrough (PR #237).

## Scope

### IN
- Add `sessionName` field to `GenieClientConfig` interface
- Store and pass `--session` in `spawnAgentSession()`
- Extract `sessionName` from `schemaConfig` in the factory (`agent-dispatcher.ts`)
- Add tests for `--session` presence/absence in spawn args

### OUT
- No changes to genie CLI — `--session` flag already implemented (genie#684)
- No new `omni providers` CLI flags — configured via `--schema-config` JSON
- No changes to message delivery or inbox logic — only affects spawn args

## Decisions

| Decision | Rationale |
|----------|-----------|
| Follow `autoSpawnDir` pattern exactly | Proven pattern from PR #237 — optional field, extract from schemaConfig, pass when truthy |
| `sessionName` not a template variable | Session groups all chats for one provider — it's a static name like `claudia-whatsapp`, not per-chat |

## Success Criteria

- [ ] `genie spawn` includes `--session claudia-whatsapp` when `sessionName` is configured
- [ ] `genie spawn` does NOT include `--session` when `sessionName` is not configured
- [ ] Existing auto-spawn tests still pass
- [ ] New tests cover both cases (with and without sessionName)

## Execution Strategy

### Wave 1 (sequential — small fix)
| Group | Agent | Description |
|-------|-------|-------------|
| 1 | engineer | Add sessionName to config, spawn args, and factory |

## Execution Groups

### Group 1: Add sessionName Passthrough

**Goal:** Pass `--session` from `schemaConfig` through to `genie spawn` so agents land in a dedicated tmux session.

**Deliverables:**

1. **`packages/core/src/providers/genie-client.ts`** — Add `sessionName` to config and spawn:

   Interface (`GenieClientConfig`, after `autoSpawnDir`):
   ```typescript
   /** Tmux session name for spawned agents — groups all chats under one session */
   sessionName?: string;
   ```

   Class property (after `autoSpawnDir`):
   ```typescript
   private readonly sessionName: string;
   ```

   Constructor (after `autoSpawnDir` assignment):
   ```typescript
   this.sessionName = config.sessionName ?? '';
   ```

   `spawnAgentSession()` (after `--cwd` block):
   ```typescript
   if (this.sessionName) {
     args.push('--session', this.sessionName);
   }
   ```

   Update JSDoc on `spawnAgentSession` to include `[--session <sessionName>]`.

2. **`packages/api/src/plugins/agent-dispatcher.ts`** — Extract and pass through in `createGenieProviderInstance()`:
   ```typescript
   const sessionName = typeof schemaConfig.sessionName === 'string' ? schemaConfig.sessionName : undefined;
   const client = createGenieClient({ teamName, agentName, targetAgent, agentRole, autoSpawnDir, sessionName });
   ```

3. **`packages/core/src/providers/__tests__/genie-client-auto-spawn.test.ts`** — Add two tests:

   ```typescript
   test('does not include --session when sessionName is not configured', async () => {
     const client = new GenieClient(makeConfig());
     await client.run(makeRequest());
     await new Promise((r) => setTimeout(r, 100));
     const genieCalls = getCallsFor('genie');
     const args = genieCalls[0]?.[1] as string[];
     expect(args).not.toContain('--session');
   });

   test('includes --session flag with sessionName', async () => {
     const client = new GenieClient(makeConfig({ sessionName: 'claudia-whatsapp' }));
     await client.run(makeRequest());
     await new Promise((r) => setTimeout(r, 100));
     const genieCalls = getCallsFor('genie');
     const args = genieCalls[0]?.[1] as string[];
     expect(args).toContain('--session');
     expect(args).toContain('claudia-whatsapp');
   });
   ```

**Acceptance Criteria:**
- [ ] When `sessionName` is not in `schemaConfig`, spawn args do NOT include `--session`
- [ ] When `sessionName` IS in `schemaConfig`, spawn args include `--session <configured-name>`
- [ ] All existing auto-spawn tests still pass

**Validation:**
```bash
cd /home/genie/agents/namastexlabs/omni/repos/omni && bun test packages/core/src/providers/__tests__/genie-client-auto-spawn.test.ts
```

**depends-on:** none (genie#684 already shipped)

---

## QA Criteria

- [ ] Configure `sessionName: "claudia-whatsapp"` in provider schemaConfig, send WhatsApp message — agent spawns in `claudia-whatsapp` tmux session
- [ ] Without `sessionName`, agent spawns in default tmux session (existing behavior)
- [ ] No regression in message delivery to team inbox

---

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `genie spawn --session` flag not yet available | None | Already shipped in genie#684, confirmed via `genie spawn --help` |

---

## Files to Create/Modify

```
packages/core/src/providers/genie-client.ts
packages/api/src/plugins/agent-dispatcher.ts
packages/core/src/providers/__tests__/genie-client-auto-spawn.test.ts
```
