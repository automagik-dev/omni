# Wish: Khal Smart Response Gate

**Status:** IN_PROGRESS
**Slug:** `khal-smart-response-gate`
**Created:** 2026-02-11
**Requested by:** Felipe
**Brainstorm:** Validated in chat session 2026-02-11

---

## Summary

Add a lightweight LLM pre-filter ("response gate") to the Omni agent-dispatcher pipeline so that agents like Khal can intelligently decide whether to respond to buffered messages. Combined with per-context debounce heartbeats (60s DM, 5min group), manual allowlist, shared group sessions, and name-match triggering — this creates a "smart assistant" behavior where Khal reads everything but only speaks when actually needed.

---

## Scope

### IN
- **LLM Response Gate**: ultrafast LLM call (flash model) after debounce flush, before main agent dispatch, to decide yes/no on responding
- **Per-context debounce config**: support different debounce windows for DM vs group on the same instance (60s DM, 5min group)
- **Session strategy**: configure `khal-whatsapp` to `per_chat` for group shared context
- **Allowlist**: switch `khal-whatsapp` to `allowlist` mode, populate with authorized numbers from `khal dev` group
- **Name match**: enable `onNameMatch` with patterns `["khal", "Khal"]` — filtered through the LLM gate to avoid false positives
- **Gate bypass**: direct @mention and reply-to-bot always bypass the gate (always respond)

### OUT
- Auto-sync allowlist from WhatsApp group membership (manual only for now)
- Changes to OpenClaw gateway protocol
- New UI for configuring the gate (API/CLI only)
- Gate for non-WhatsApp channels (scope to WhatsApp first, generalize later)
- Changing the debounce mode system itself (fixed-window already shipped)

---

## Decisions

- **DEC-1:** The LLM gate runs AFTER debounce flush, not before. This way it sees the full buffered conversation, not individual messages.
- **DEC-2:** Gate model is configurable per-instance (`agentGateModel` field). Default: `gemini-3-flash-preview` via Juice.
- **DEC-3:** Direct @mention and reply-to-bot BYPASS the gate entirely (always dispatch). The gate only filters `onDm` and `onNameMatch` triggers.
- **DEC-4:** The gate prompt receives: buffered messages (with sender names), chat type (dm/group), agent name. Returns: `respond` or `skip` with optional reason.
- **DEC-5:** Gate timeout: 3s max. If gate fails or times out, default to RESPOND (fail-open).
- **DEC-6:** Per-context debounce is achieved via a new `messageDebounceGroupMs` field. If set, group chats use this value; DMs use `messageDebounceMinMs`.
- **DEC-7:** Session strategy for `khal-whatsapp` set to `per_chat` — group shares one context, each DM is isolated.

---

## Risks & Mitigations

- **Risk:** Flash model occasionally says "skip" when it should respond.
  - **Mitigation:** @mention/reply bypass the gate. Gate prompt tuned for "when in doubt, respond." Fail-open on timeout/error.
- **Risk:** Extra latency from gate call.
  - **Mitigation:** Flash model is <1s. Already debouncing 60s-5min, so <1s is negligible.
- **Risk:** Gate cost accumulates on high-traffic groups.
  - **Mitigation:** Gate only fires after debounce flush (not per-message). Flash model is very cheap (~$0.001 per call).

---

## Success Criteria

- [ ] LLM gate blocks false-positive name matches in groups (e.g., "I told Khal yesterday" → no response)
- [ ] LLM gate allows genuine requests (e.g., "Khal, what do you think?" → response)
- [ ] Direct @mention always triggers response (bypasses gate)
- [ ] Reply-to-bot always triggers response (bypasses gate)
- [ ] DM debounce is 60s, group debounce is 5min on same instance
- [ ] Group chat uses shared session (`per_chat` strategy)
- [ ] DM chats are isolated per user
- [ ] Only allowlisted numbers can interact with Khal
- [ ] Gate failure/timeout defaults to responding (fail-open)
- [ ] Gate model and prompt are configurable per-instance

---

## Execution Groups

### Group A — Instance Configuration (no code changes)
**Goal:** Configure `khal-whatsapp` with allowlist, session strategy, name match, and group debounce using existing API fields.

**Deliverables**
- Switch `accessMode` to `allowlist` and populate with authorized numbers
- Enable `onNameMatch` with patterns `["khal", "Khal"]`
- Set `agentSessionStrategy` to `per_chat`
- Set debounce: 60s for DMs (already done), document group debounce target (5min)

**Acceptance Criteria**
- [ ] `accessMode=allowlist` with correct numbers
- [ ] `onNameMatch=true` with `namePatterns=["khal","Khal"]`
- [ ] `agentSessionStrategy=per_chat`
- [ ] Unauthorized numbers are blocked

**Validation Commands**
- `~/.omni/bin/omni instances get 0567bded-23f6-439f-b49f-773fa7f47419`
- Send message from unauthorized number → verify no response
- Send message from authorized number → verify response

**Likely Files Touched**
- None (API config only)

---

### Group B — Per-Context Debounce (DM vs Group)
**Goal:** Add `messageDebounceGroupMs` field so the same instance can have different debounce windows for DM and group chats.

**Deliverables**
- New DB column: `message_debounce_group_ms` on instances table (nullable, default null = use same as DM)
- API schema update: accept `messageDebounceGroupMs` in instance PATCH
- Debouncer logic: when flushing, check if chatId is group (`@g.us`) and use group debounce if set
- Configure `khal-whatsapp`: `messageDebounceMinMs=60000`, `messageDebounceGroupMs=300000`

**Acceptance Criteria**
- [ ] DM messages debounce at 60s
- [ ] Group messages debounce at 5min (300s)
- [ ] Null `messageDebounceGroupMs` falls back to DM debounce value
- [ ] API accepts and returns `messageDebounceGroupMs` field

**Validation Commands**
- `make typecheck && make lint`
- `bun test packages/api/src/plugins/__tests__/agent-dispatcher.test.ts`
- `~/.omni/bin/omni instances get 0567bded` (verify field)

**Likely Files Touched**
- `packages/core/src/db/schema.ts` (new column)
- `packages/api/src/routes/v2/instances.ts` (API schema)
- `packages/api/src/plugins/agent-dispatcher.ts` (debouncer group check)
- Migration file

---

### Group C — LLM Response Gate
**Goal:** Add a lightweight LLM pre-filter that decides whether to dispatch to the main agent after debounce flush.

**Deliverables**
- New function `shouldRespondViaGate(messages, chatType, instanceConfig)` → `boolean`
- Calls flash model with buffered messages, chat context, agent name
- Gate prompt: "Given these messages, should the agent respond? ..." → `respond`/`skip`
- New instance fields: `agentGateEnabled` (bool), `agentGateModel` (string), `agentGatePrompt` (string, optional override)
- Wire into dispatcher: after debounce flush, before `dispatchViaProvider`, run gate check
- Bypass logic: if trigger type is `mention` or `reply`, skip the gate

**Acceptance Criteria**
- [ ] Gate fires after debounce flush for `dm` and `name_match` triggers
- [ ] Gate is skipped for `mention` and `reply` triggers
- [ ] Gate uses configurable model (default: `gemini-3-flash-preview`)
- [ ] Gate timeout (3s) → fail-open (respond)
- [ ] Gate error → fail-open (respond)
- [ ] "I told Khal yesterday" in group → gate says skip
- [ ] "Khal, deploy the latest version" in group → gate says respond
- [ ] Gate result logged with traceId for debugging

**Validation Commands**
- `make typecheck && make lint`
- `bun test packages/api`
- Manual test: send false-positive and genuine messages in group

**Likely Files Touched**
- `packages/core/src/db/schema.ts` (new columns)
- `packages/api/src/routes/v2/instances.ts` (API schema)
- `packages/api/src/plugins/agent-dispatcher.ts` (gate logic)
- `packages/api/src/plugins/__tests__/agent-dispatcher.test.ts` (gate tests)

---

### Group D — Validation & Report
**Goal:** End-to-end validation of the full pipeline on `khal-whatsapp` and documentation.

**Deliverables**
- Test matrix: DM allowed, DM blocked, group @mention, group reply, group name match (genuine), group name match (false positive), gate timeout
- Evidence collection (logs + outcomes)
- Final report with test results

**Acceptance Criteria**
- [ ] All test scenarios executed with PASS/FAIL
- [ ] No regressions on existing WhatsApp functionality
- [ ] Report committed to repo

**Validation Commands**
- `ssh omni@10.114.1.140 "pm2 logs omni-v2-api --nostream --lines 200"` (filtered for gate/dispatch logs)
- `~/.omni/bin/omni events list --instance 0567bded --limit 20`

**Likely Files Touched**
- `docs/reports/khal-smart-response-gate-qa.md`
- `memory/2026-02-11.md`

---

### Group E — CLI/Sync UX for Group Allowlist Discovery
**Goal:** Make Omni CLI self-sufficient for discovering group participants so allowlist setup does not require manual number sharing.

**Why:** During Group A execution, `omni chats participants <group-chat-id>` only returned users who already generated chat participant rows (message-derived), while `omni instances groups` showed `MEMBERS=5` for `Khal - Dev`. This prevented building allowlist from CLI alone.

**Deliverables**
- Add a CLI/API path that returns full group participant identifiers from provider metadata (Baileys `groupMetadata`) for a given group JID/chat ID
- Improve `omni chats participants` output to indicate source (`db` vs `provider`) and fallback behavior
- Add a friendly hint when DB participants are partial (e.g., "showing 1/5 known participants; run with --provider to fetch full list")
- Add command docs/examples for allowlist workflow (`instances groups` → participants fetch → access allowlist update)

**Acceptance Criteria**
- [ ] `omni` can list all group participants for `120363422318124751@g.us` without requiring each member to send a message first
- [ ] Output includes stable identifiers usable for allowlist configuration
- [ ] Partial-data scenarios are explicit and user-friendly
- [ ] Group A can be completed using CLI only

**Validation Commands**
- `~/.omni/bin/omni instances groups 0567bded-23f6-439f-b49f-773fa7f47419 --search "Khal - Dev"`
- `~/.omni/bin/omni chats participants c718893f-a778-4443-a39b-4c2daf763819 --provider`
- `~/.omni/bin/omni access rules list --instance 0567bded-23f6-439f-b49f-773fa7f47419`

**Likely Files Touched**
- `packages/cli/src/commands/chats.ts`
- `packages/api/src/routes/v2/instances.ts` and/or chats routes
- `packages/channel-whatsapp/src/plugin.ts` (participant fetch endpoint wiring)
- CLI docs / help text

---

## Notes

- The fixed-window debounce behavior (non-restarting) was already shipped in `be2e309`.
- The cumulative-snapshot accumulation fix was shipped in `85fea18`.
- Existing `khal-whatsapp` config: `agentProviderId=dab06a5c`, `agentId=khal`, `messageDebounceMode=fixed`, `messageDebounceMinMs=60000`.
- The LLM gate is the novel piece — Groups A and B are mostly config + small schema changes.
