# Wish: Omni ↔ Genie Integration v2

| Field | Value |
|-------|-------|
| **Status** | DRAFT |
| **Slug** | `omni-genie-integration-v2` |
| **Date** | 2026-03-17 |

## Summary
Rewrite Omni's genie provider to use `genie spawn <agent> --team <name>` instead of the removed `genie team ensure`. The current auto-spawn code calls a CLI command that no longer exists — falling back to a bare tmux spawn without agent identity. The new pattern creates parallel agent sessions per conversation (DM, group, thread) with full AGENTS.md context from the genie agent directory.

## Scope

### IN
- Rewrite `GenieClient.spawnTeamLead()` to call `genie spawn <agent> --team <team-name>`
- Add `agentRole` config field — the registered agent name in `genie dir` (e.g., `omni-pm`, `cegonha`)
- Remove all `genie team ensure` references and the direct tmux fallback (`spawnViaTmux`)
- Keep inbox file write mechanism unchanged (lockfile + atomic write — proven working)
- Keep metadata header format unchanged (`[channel:X instance:Y chat:Z thread:T]`)
- Keep template variable interpolation for team names
- Update genie-client tests to reflect new spawn mechanism
- Add `agentRole` to the genie provider DB schema / instance config

### OUT
- Changing the inbox-bridge plugin (reply path is unchanged)
- Changing the metadata header format
- Changing the genie CLI itself
- Modifying any channel plugins
- Adding reply capability to genie-client (agents reply via `omni send` CLI, not through the provider)

## Decisions

| Decision | Rationale |
|----------|-----------|
| `genie spawn` not `genie team ensure` | `ensure` was removed from Genie CLI. `spawn` creates native team + loads AGENTS.md from `genie dir` registration. Validated in live test. |
| Agent name from config, not hardcoded | Different instances may use different agents (`omni-pm` for PM bot, `cegonha` for personal assistant). Must be configurable per instance. |
| Remove `spawnViaTmux` fallback | The fallback spawns bare Claude Code without AGENTS.md or agent identity. Better to fail clearly than spawn a broken session. |
| Keep inbox write unchanged | Lockfile + atomic write pattern is proven. `genie spawn` creates the inbox directory; direct file write delivers the message. |
| Team name = `{instance}-{chat_id}[-{thread_id}]` | Proven pattern from Telegram test. Isolates conversations. Thread suffix only when threadId exists. |

## Success Criteria
- [ ] `genie-client.ts` calls `genie spawn <agentRole> --team <teamName>` instead of `genie team ensure`
- [ ] `spawnViaTmux()` method removed entirely
- [ ] New `agentRole` field in `GenieClientConfig` (required string, e.g. `"omni-pm"`)
- [ ] Template interpolation still works for team names (`{chat_id}`, `{thread_id}`, etc.)
- [ ] Inbox file write still uses lockfile + atomic rename pattern
- [ ] When agent session already exists for a team, spawn is skipped (idempotent via `knownTeams` cache)
- [ ] `bun test` passes with zero regressions
- [ ] genie-client e2e tests updated to test `genie spawn` invocation

## Execution Groups

### Group 1: Rewrite GenieClient Spawn Logic
**Goal:** Replace `genie team ensure` + `spawnViaTmux` with `genie spawn <agent> --team <team>`.

**Deliverables:**
1. Add `agentRole: string` to `GenieClientConfig` (the genie-dir registered agent name)
2. Replace `spawnTeamLead(teamName)` with `spawnAgentSession(teamName)`:
   - Call: `genie spawn <agentRole> --team <teamName>`
   - Pass `--cwd <autoSpawnDir>` if configured
   - On success: mark team known in cache
   - On failure: log warning (fire-and-forget, don't block message delivery)
3. Remove `spawnViaTmux()` method entirely
4. Simplify `checkAndSpawnTeam()`:
   - If team in `knownTeams` cache (TTL valid) → skip
   - If team in `pendingTeams` → skip (coalesce)
   - Otherwise → call `spawnAgentSession()`
   - On cache TTL expiry: re-call `genie spawn` which is idempotent (no-op if session exists, ~2s cost max once per 5 min per team — acceptable)
6. Keep `ensureTeamExists()` as the fire-and-forget wrapper (unchanged interface)

**Acceptance criteria:**
- `genie spawn` called with correct agent name and team name
- No references to `genie team ensure` remain
- No `spawnViaTmux` method exists
- `knownTeams` TTL cache still works (5 min expiry)
- `pendingTeams` coalescing still works

**Validation:**
```bash
cd /home/genie/agents/namastexlabs/omni/repos/omni && \
bun test && \
grep -q "genie.*spawn" packages/core/src/providers/genie-client.ts && \
grep -q "agentRole" packages/core/src/providers/genie-client.ts && \
! grep -q "team.*ensure" packages/core/src/providers/genie-client.ts && \
! grep -q "spawnViaTmux" packages/core/src/providers/genie-client.ts && \
echo "PASS"
```

**depends-on:** none

---

### Group 2: Update Tests
**Goal:** Update genie-client tests to verify `genie spawn` invocation pattern.

**Deliverables:**
1. Update `packages/core/src/providers/__tests__/genie-client-e2e.test.ts`:
   - Test that spawn calls `genie spawn <agent> --team <team>` with correct args
   - Test that `agentRole` is passed correctly
   - Test idempotency: second spawn for same team is skipped (cache hit)
   - Remove any tests referencing `team ensure` or `spawnViaTmux`
2. Verify existing inbox write tests still pass unchanged

**Acceptance criteria:**
- Tests verify `genie spawn` command is called with `--team` flag
- Tests verify `agentRole` is used as the spawn target
- No test references `team ensure` or `spawnViaTmux`
- All tests pass

**Validation:**
```bash
cd /home/genie/agents/namastexlabs/omni/repos/omni && \
bun test packages/core/src/providers/__tests__/genie-client-e2e.test.ts && \
grep -q "genie.*spawn" packages/core/src/providers/__tests__/genie-client-e2e.test.ts && \
! grep -q "team.*ensure" packages/core/src/providers/__tests__/genie-client-e2e.test.ts && \
echo "PASS"
```

**depends-on:** Group 1

---

### Group 3: Wire agentRole into Provider Config
**Goal:** Make `agentRole` configurable per instance so different bots use different agents.

**Deliverables:**
1. Add `agentRole` to the genie provider schema in `packages/core/src/providers/genie-provider.ts`
2. Pass `agentRole` from instance config through to `GenieClient` constructor
3. Check if `providerConfig` or `schemaConfig` JSON field already exists on instances — use it instead of adding a new column. If no JSON config mechanism exists, add `agentRole` column with DB migration.
4. Update CLI setup wizard (`packages/cli/src/commands/`) to prompt for agent role during genie provider setup

**Acceptance criteria:**
- `agentRole` flows from instance DB config → GenieAgentProvider → GenieClient
- Default value: `"team-lead"` (backward compatible — uses Genie built-in team-lead prompt, not a registered agent. This is intentional: existing instances without `agentRole` configured get a generic Claude Code session rather than failing.)
- CLI wizard asks for agent role when setting up genie provider
- DB migration if new column added

**Validation:**
```bash
cd /home/genie/agents/namastexlabs/omni/repos/omni && \
bun test && \
grep -q "agentRole" packages/core/src/providers/genie-provider.ts && \
echo "PASS"
```

**depends-on:** Group 1

---

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `genie spawn` may change CLI interface in future versions | Low | Pin to known working pattern. The `--team` flag is stable. |
| Agent not registered in `genie dir` → spawn fails | Medium | Clear error message. Document that agents must be registered via `genie dir add` before use. |
| Multiple Omni instances spawning same team simultaneously | Low | `pendingTeams` set coalesces concurrent requests. `genie spawn` itself is idempotent. |
| Existing instances have no `agentRole` configured | Low | Default to `"team-lead"` for backward compatibility. |
