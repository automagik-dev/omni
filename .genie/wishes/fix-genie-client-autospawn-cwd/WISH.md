# Wish: Fix Genie Client Auto-Spawn CWD Override

| Field | Value |
|-------|-------|
| **Status** | SHIP |
| **Slug** | `fix-genie-client-autospawn-cwd` |
| **Date** | 2026-03-20 |

## Summary

The Genie provider's auto-spawn logic always passes `--cwd ~/workspace` to `genie spawn`, overriding the agent's registered directory from `genie dir`. This causes agents to start in the wrong folder (or fail if `~/workspace` doesn't exist), ignoring the agent's natural CWD where its AGENTS.md, SOUL.md, and memory live. The fix removes the hardcoded default and passes `autoSpawnDir` from `schemaConfig` when explicitly configured.

## Scope

### IN
- Remove hardcoded `~/workspace` default from `GenieClient` constructor
- Pass `autoSpawnDir` from `schemaConfig` through the factory in `agent-dispatcher.ts`
- Update existing tests to reflect the new default behavior

### OUT
- No changes to the `genie` CLI itself — it already resolves CWD from `genie dir` correctly
- No changes to other provider schemas (claude-code, agno, webhook, etc.)
- No new CLI flags for `omni providers create/update`

## Decisions

| Decision | Rationale |
|----------|-----------|
| Default `autoSpawnDir` to empty string instead of `~/workspace` | When empty, `genie spawn` uses the agent's registered dir from `genie dir`, which is the correct behavior. `~/workspace` was an arbitrary default that doesn't exist on most setups |
| Pass `autoSpawnDir` through factory rather than removing the field | Preserves the ability to explicitly override CWD via `schemaConfig` for edge cases |

## Success Criteria

- [ ] `genie spawn <agent> --team <name>` uses the agent's registered dir when `autoSpawnDir` is not configured
- [ ] `genie spawn <agent> --team <name> --cwd <path>` still works when `autoSpawnDir` IS explicitly set in `schemaConfig`
- [ ] Existing genie-client tests pass
- [ ] No `--cwd` flag appears in spawn args when `autoSpawnDir` is not set

## Execution Strategy

### Wave 1 (sequential — small fix)
| Group | Agent | Description |
|-------|-------|-------------|
| 1 | engineer | Fix default and factory passthrough |

## Execution Groups

### Group 1: Fix autoSpawnDir Default and Factory Passthrough

**Goal:** Stop the Genie client from overriding the agent's natural CWD with a hardcoded `~/workspace` default.

**Deliverables:**

1. **`packages/core/src/providers/genie-client.ts` line 121** — Change default from `join(homedir(), 'workspace')` to `''`:
   ```typescript
   // Before:
   this.autoSpawnDir = config.autoSpawnDir ?? join(homedir(), 'workspace');
   // After:
   this.autoSpawnDir = config.autoSpawnDir ?? '';
   ```

2. **`packages/api/src/plugins/agent-dispatcher.ts` ~line 2658-2661** — Extract `autoSpawnDir` from `schemaConfig` and pass to client:
   ```typescript
   // Before:
   const client = createGenieClient({ teamName, agentName, targetAgent, agentRole });
   // After:
   const autoSpawnDir = typeof schemaConfig.autoSpawnDir === 'string' ? schemaConfig.autoSpawnDir : undefined;
   const client = createGenieClient({ teamName, agentName, targetAgent, agentRole, autoSpawnDir });
   ```

3. **Update tests** — Add a test in `packages/core/src/providers/__tests__/genie-client-auto-spawn.test.ts` asserting that spawn args do NOT include `--cwd` when `autoSpawnDir` is not configured. Existing tests pass as-is (none assert the old default).

**Acceptance Criteria:**
- [ ] When `autoSpawnDir` is not in `schemaConfig`, spawn args do NOT include `--cwd`
- [ ] When `autoSpawnDir` IS in `schemaConfig`, spawn args include `--cwd <configured-path>`
- [ ] `homedir()` import is NOT removed — it is still used for inbox paths (lines 194, 405, 424)

**Validation:**
```bash
cd /home/genie/agents/namastexlabs/omni/repos/omni && bun test packages/core/src/providers/__tests__/genie-client-auto-spawn.test.ts
```

**depends-on:** none

---

## QA Criteria

- [ ] Send a WhatsApp message to ClaudiA instance — agent spawns in its registered dir (not `~/workspace`)
- [ ] Provider with explicit `autoSpawnDir` in `schemaConfig` still overrides CWD correctly
- [ ] No regression in message delivery to team inbox

---

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Other deployments rely on `~/workspace` default | Low | The default was undocumented and broken (dir doesn't exist). Any working setup already has explicit `autoSpawnDir` or doesn't use auto-spawn |

---

## Files to Create/Modify

```
packages/core/src/providers/genie-client.ts
packages/api/src/plugins/agent-dispatcher.ts
packages/core/src/providers/__tests__/genie-client-auto-spawn.test.ts
```
