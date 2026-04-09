# Wish: Omni Finish Line — Tests, Pipeline, Docs

| Field | Value |
|-------|-------|
| **Status** | DRAFT |
| **Slug** | `omni-finish-line` |
| **Date** | 2026-03-24 |
| **Design** | Consolidated from previous wishes + QA audit |

## Summary
Three threads of unfinished work from omni-day: (1) missing test coverage for the event-driven media pipeline and chat scoping that already shipped, (2) the dispatcher pipeline reorder so per-user debounce overrides actually work (schema+API+merge already shipped), and (3) the remaining 16 CLI command groups that agents need documented. No more promises without proof.

## Scope
### IN
- **Tests**: 5 missing test suites for code already on dev (media await + chat scoping)
- **Pipeline**: Move route resolution before debounce in dispatcher + typing handler
- **Tests**: Route config override merge tests + debounce override integration test
- **Docs**: 16 remaining CLI command groups in commands.md (#256)

### OUT
- New features — all code features already shipped, this is completion work
- Media processing service changes (Gemini/Whisper)
- Global genie plugin skills (separate repo)
- Auto-generated OpenAPI docs

## Decisions
| Decision | Rationale |
|----------|-----------|
| Tests for shipped code FIRST (Group 1) | We promised tests and didn't deliver. Debt before new work. |
| Pipeline reorder is isolated to one function in one file | `message.received` handler ~line 3682. Move `resolveEffectiveInstance()` before `getDebounceConfig()`. Well-scoped. |
| CLI docs: run `omni <cmd> --help` for each, follow existing template | 4 commands already documented as template. Mechanical work. |
| All groups independent — max parallelism | Tests don't depend on pipeline. Docs don't depend on either. Ship fast. |

## Success Criteria
- [ ] `awaitMediaProcessing()` has unit tests: event resolve, cache hit, error event, promise cleanup
- [ ] Chat scoping has unit test: instanceIds filter returns correct chats
- [ ] Route-resolved debounce works: route with `messageDebounceMode: 'disabled'` → no debounce for that user
- [ ] Config merge test: all 14 route fields override instance defaults, null inherits
- [ ] `commands.md` has 25 documented command groups (currently 9)
- [ ] All existing tests pass: `bun test` (465+ pass, 0 fail)
- [ ] TypeScript compiles: `bunx tsc --noEmit`
- [ ] Close #242 and #256

## Execution Strategy

### Wave 1 (all parallel — zero dependencies between groups)
| Group | Agent | Description |
|-------|-------|-------------|
| 1 | engineer | Tests: media await + chat scoping (debt payoff) |
| 2 | engineer | Dispatcher pipeline: early route resolution for debounce |
| 3 | engineer | CLI docs: 8 medium-priority commands (persons, media, automations, webhooks, batch, prompts, journey, resync) |
| 4 | engineer | CLI docs: 8 low-priority commands (settings, dead-letters, payloads, logs, config, auth, status, completions) |

### Wave 2 (after Groups 1+2)
| Group | Agent | Description |
|-------|-------|-------------|
| 5 | engineer | Tests: route config merge + debounce override |

## Execution Groups

### Group 1: tests-media-and-scoping
**Goal:** Write the tests we promised but didn't deliver for the event-driven media pipeline and chat scoping.
**Deliverables:**
1. **New file: `packages/api/src/plugins/__tests__/media-await.test.ts`**
   - Test `awaitMediaProcessing()` resolves when `media.processed` event fires (mock eventBus, trigger event, verify promise resolves with content)
   - Test cache hit: set entry in `mediaResultCache` before calling `awaitMediaProcessing()` → returns immediately without awaiting promise
   - Test error event: `media.processed` with `content: '', error: 'API failure'` → returns `MEDIA_WAIT_NULL`
   - Test DB-already-done: mock `getByExternalId` returning message with `imageDescription` already set → returns immediately
   - Test promise cleanup: create promise in `mediaCompletions`, advance time past 10min → promise rejected with `media_promise_leaked`

2. **New file: `packages/api/src/__tests__/chat-scoping.test.ts`**
   - Test `services.chats.list({ instanceIds: ['inst-1'] })` only returns chats with `instanceId = 'inst-1'`
   - Test `services.chats.list({})` (no instanceIds) returns all chats
   - Test `services.chats.list({ instanceIds: ['inst-1', 'inst-2'] })` returns chats from both

**Acceptance Criteria:**
- [ ] `bun test media-await` passes with 5+ test cases
- [ ] `bun test chat-scoping` passes with 3+ test cases
- [ ] All existing tests still pass

**Validation:**
```bash
cd /home/genie/agents/namastexlabs/omni/repos/omni/packages/api && bun test media-await && bun test chat-scoping
```

**depends-on:** none

---

### Group 2: early-route-resolution
**Goal:** Move route resolution before debounce so per-user debounce overrides actually take effect.
**Deliverables:**
1. **`packages/api/src/plugins/agent-dispatcher.ts`** — In the `message.received` handler (~line 3682):
   - After `shouldProcessMessage()` returns the base instance (~line 3692)
   - Look up internal chat: `const chat = await services.chats.findByExternalIdSmart(instance.id, payload.chatId)`
   - Call `resolveEffectiveInstance(services, db, instance, chat?.id, metadata.personId)` to get route-resolved instance
   - Use `getDebounceConfig(resolved)` instead of `getDebounceConfig(instance)` at line 3695
   - Store the resolved instance + routeId in the buffer metadata
   - In the debounce callback (~line 3630): use the pre-resolved instance from the first message's metadata, skip the redundant `resolveEffectiveInstance()` call

2. **`packages/api/src/plugins/message-debouncer.ts`** — Add optional `resolvedInstance` and `routeId` to `DispatchMetadata` interface so the buffer can carry them

3. **Typing handler** (~line 3860): Also resolve route before checking `restartOnTyping`

**Acceptance Criteria:**
- [ ] `getDebounceConfig()` is called with the route-resolved instance, not the base instance
- [ ] Debounce callback does NOT call `resolveEffectiveInstance()` again (no double resolution)
- [ ] TypeScript compiles: `bunx tsc --noEmit`
- [ ] Existing tests pass

**Validation:**
```bash
cd /home/genie/agents/namastexlabs/omni/repos/omni && bunx tsc --noEmit && cd packages/api && bun test
```

**depends-on:** none

---

### Group 3: cli-docs-medium-priority
**Goal:** Document 8 medium/high-priority CLI command groups.
**Deliverables:**
Add to `.claude/skills/omni-cli/reference/commands.md`:

1. **`omni automations`** (10 subcommands: list, get, create, update, delete, enable, disable, test, execute, logs) — HIGH priority, agents use automations frequently
2. **`omni journey`** (2: show, summary) — HIGH priority, debugging tool
3. **`omni persons`** (3: search, get, presence)
4. **`omni media`** (2: list, download)
5. **`omni webhooks`** (6: list, get, create, update, delete, trigger)
6. **`omni batch`** (5: list, create, status, cancel, estimate)
7. **`omni prompts`** (4: list, get, set, reset)
8. **`omni resync`** (standalone: --instance, --since, --all, --dry-run)

**Method:** Run `omni <cmd> --help` and `omni <cmd> <sub> --help` for each. Follow the template from the existing routes/providers/access/keys sections. Each subcommand gets description + options + 1-2 practical examples.

**Acceptance Criteria:**
- [ ] 8 new sections added with all subcommands documented
- [ ] Each subcommand has at least one `bash` example

**Validation:**
```bash
grep -c "^## omni\|^### omni" /home/genie/agents/namastexlabs/omni/repos/omni/.claude/skills/omni-cli/reference/commands.md
# Should be 17+ (9 existing + 8 new)
```

**depends-on:** none

---

### Group 4: cli-docs-low-priority
**Goal:** Document the final 8 CLI command groups — complete the reference.
**Deliverables:**
Add to `.claude/skills/omni-cli/reference/commands.md`:

1. **`omni dead-letters`** (6: list, get, stats, retry, resolve, abandon)
2. **`omni payloads`** (4: list, get, delete, config)
3. **`omni settings`** (3: list, get, set)
4. **`omni logs`** (standalone: level, --modules, --process, --follow)
5. **`omni config`** (4: list, get, set, unset)
6. **`omni auth`** (4: login, status, logout, recover)
7. **`omni status`** (standalone)
8. **`omni completions`** (standalone: bash, zsh, fish)

Also update the **command index** at the top of `commands.md` to list and link all 25 sections.

**Method:** Same as Group 3 — `omni <cmd> --help` for each, practical examples.

**Acceptance Criteria:**
- [ ] 8 new sections added
- [ ] Command index at top lists all 25 groups with anchor links
- [ ] Total: 25 documented command groups

**Validation:**
```bash
grep -c "^## omni " /home/genie/agents/namastexlabs/omni/repos/omni/.claude/skills/omni-cli/reference/commands.md
# Should be 25
```

**depends-on:** none (but should run AFTER Group 3 to avoid merge conflicts on same file — see execution strategy note)

> ⚠️ Groups 3 and 4 both write to `commands.md`. If running truly parallel, they must coordinate appends. Safer: run Group 4 after Group 3 completes on the same branch.

---

### Group 5: tests-route-overrides
**Goal:** Test the route config merge and debounce override pipeline.
**Deliverables:**
1. **New file: `packages/api/src/plugins/__tests__/route-config-merge.test.ts`**
   - Test: all 14 route override fields beat instance defaults when set
   - Test: null route fields inherit from instance (no override)
   - Test: `getDebounceConfig()` with route-resolved instance returns route's debounce values
   - Test: `getSplitDelayConfig()` with route-resolved instance returns route's split values
   - Test: route with `messageDebounceMode: 'disabled'` → debounce config has `mode: 'disabled'`

**Acceptance Criteria:**
- [ ] All new tests pass
- [ ] Existing tests pass

**Validation:**
```bash
cd /home/genie/agents/namastexlabs/omni/repos/omni/packages/api && bun test route-config-merge
```

**depends-on:** Group 2 (needs the pipeline reorder to test debounce with resolved instance)

---

## QA Criteria

_What must be verified on dev after all groups merge._

- [ ] `bun test` — 0 failures across all packages
- [ ] `bunx tsc --noEmit` — zero type errors
- [ ] `commands.md` has 25 `## omni` sections
- [ ] AGENT_ROUTING.md has zero old JSON format
- [ ] `awaitMediaProcessing` has dedicated test file with 5+ tests
- [ ] Chat scoping has dedicated test file with 3+ tests
- [ ] Route config merge has dedicated test file with 5+ tests
- [ ] `getDebounceConfig()` is called with resolved instance (grep for the pattern)

---

## Assumptions / Risks
| Risk | Severity | Mitigation |
|------|----------|------------|
| Groups 3+4 conflict on commands.md | Medium | Run Group 4 after Group 3 on same branch, or use separate append sections |
| Pipeline reorder may break existing debounce tests | Medium | Run full test suite after Group 2. The change is localized to one handler. |
| `resolveEffectiveInstance()` called earlier adds latency | Low | Route resolver caches. No-route case (most messages) returns null instantly. |
| Test mocking of NATS eventBus | Low | Existing tests already mock eventBus. Follow same pattern. |

---

## Files to Create/Modify

```
# Group 1: Tests (media + scoping)
packages/api/src/plugins/__tests__/media-await.test.ts        # NEW
packages/api/src/__tests__/chat-scoping.test.ts               # NEW

# Group 2: Pipeline reorder
packages/api/src/plugins/agent-dispatcher.ts                  # Move resolveEffectiveInstance before getDebounceConfig
packages/api/src/plugins/message-debouncer.ts                 # Add resolvedInstance to DispatchMetadata

# Group 3+4: CLI docs
.claude/skills/omni-cli/reference/commands.md                 # Add 16 command sections

# Group 5: Route override tests
packages/api/src/plugins/__tests__/route-config-merge.test.ts # NEW
```

---

## GitHub Issues
- Closes #242 (route-level config overrides — all code + tests done)
- Closes #256 (CLI reference completion — all 25 commands documented)
