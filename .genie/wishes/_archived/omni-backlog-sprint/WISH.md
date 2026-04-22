# Wish: Omni Backlog Sprint — Bugs, UX, and Platform Fixes

| Field | Value |
|-------|-------|
| **Status** | DRAFT |
| **Slug** | `omni-backlog-sprint` |
| **Date** | 2026-03-17 |

## Summary
Address all confirmed open bugs and high-priority features across the Omni platform. Covers automation engine P0, CLI UX fixes, agent acknowledgment, WhatsApp mentions, genie provider auto-spawn, and channel error standardization. Triaged from 14 open issues — 4 closed as already fixed, 3 deferred (P3), 7 addressed here.

## Scope

### IN
- Fix automation engine (GH#215) — P0 critical bug
- Fix CLI chats list truncation (GH#201) — P1 UX bug
- Fix `omni send --to` short ID resolution (GH#200) — P1 UX bug
- Add agent message auto-acknowledgment (GH#214) — P1 feature
- Migrate channel error classes to core ChannelError (GH#81) — P1 SDK
- Add WhatsApp @name mention resolver (GH#209) — P2 feature
- Fix genie auto-spawn tmux session creation (GH#202 + GH#208) — P2 infra

### OUT
- SDK compliance test suite (GH#82) — deferred, blocked by other items
- Performance benchmarks (GH#93) — P3, deferred
- Channel plugin generator (GH#92) — P3, deferred
- PR #182 (chat attention system) — separate PR, needs rebase
- PR #181 (LinkedIn channel) — separate PR, needs rebase + review feedback
- Any work on channels beyond WhatsApp/Telegram/Discord/Slack

## Decisions

| Decision | Rationale |
|----------|-----------|
| P0 automation fix first | Automations are 100% broken — zero users can use them. Two-line fix with massive impact. |
| Bundle CLI UX fixes together | #200 and #201 are both CLI list/send issues that affect agent reliability. Fix together. |
| Auto-ack before mention resolver | #214 affects all agent-backed instances. #209 only affects WhatsApp group mentions. |
| Combine #202 + #208 | Both about genie provider auto-spawn — cache health and tmux session creation are the same fix surface. |
| Defer SDK compliance suite | Blocked by other items and large scope. Better as its own wish after this sprint. |

## Success Criteria
- [ ] Automations fire automatically on NATS events (GH#215 both bugs fixed)
- [ ] `omni chats list` shows pagination metadata and doesn't silently truncate (GH#201)
- [ ] `omni send --to <short-id>` resolves short chat IDs correctly (GH#200)
- [ ] Agent messages get auto-acknowledgment before processing (GH#214)
- [ ] All 4 channel error classes extend core ChannelError (GH#81)
- [ ] `omni send --text "@felipe ..."` resolves @name to WhatsApp JID (GH#209)
- [ ] Genie provider auto-spawns tmux sessions correctly from PM2 context (GH#202+#208)
- [ ] `bun test` passes with zero regressions

## Execution Groups

### Group 1: Automation Engine Fix (P0)
**Goal:** Fix the two bugs that prevent all automations from firing. GH#215.

**Deliverables:**
1. Call `services.automations.startEngine({})` in `setupEventBusServices()` so the engine subscribes to NATS at startup
2. Merge `event.metadata` into the condition evaluation payload in `handleEvent()` so conditions referencing `instanceId` and other metadata fields match correctly

**Acceptance criteria:**
- `startEngine()` called during server startup
- Condition evaluator receives merged `{...metadata, ...payload}`
- Automations trigger on matching NATS events

**Validation:**
```bash
cd /home/genie/agents/namastexlabs/omni/repos/omni && \
bun test && \
grep -rq "startEngine" packages/api/src/ && \
grep -rq "metadata.*payload\|\.\.\.event\.metadata" packages/api/src/ && \
echo "PASS"
```

**depends-on:** none

---

### Group 2: CLI UX Fixes (P1)
**Goal:** Fix silent truncation in chats list and short ID resolution in send. GH#201 + GH#200.

**Deliverables:**
1. **Chats list pagination** (GH#201):
   - Add pagination metadata to response (`total`, `hasMore`)
   - Show truncation warning on CLI when results are limited
   - When `--type` is specified, default to no limit (give all matching)
   - Fix `--limit 200` causing 400 errors (server-side max validation)

2. **Short ID resolution in send** (GH#200):
   - Support short ID resolution in `omni send --to` (same resolver as `omni chats messages`)
   - Clear error message when `--to` value doesn't resolve

**Acceptance criteria:**
- `omni chats list` shows total count and truncation warning
- `omni chats list --type group` returns all groups regardless of limit
- `omni send --to <short-id>` resolves to full chat ID
- Unresolvable `--to` shows clear error

**Validation:**
```bash
cd /home/genie/agents/namastexlabs/omni/repos/omni && \
bun test && \
grep -rq "total\|hasMore" packages/api/src/ && \
grep -rq "resolveShortId\|shortId\|short.id" packages/cli/src/ packages/sdk/src/ && \
echo "PASS"
```

**depends-on:** none

---

### Group 3: Agent Auto-Acknowledgment (P1)
**Goal:** Send immediate acknowledgment to users before agent processing starts, and error feedback on failure. GH#214.

**Deliverables:**
1. Wire up `ackProvider` for WhatsApp reactions (currently null at dispatch time)
2. Add configurable text auto-reply before agent dispatch (e.g., `agentAckMessage: "Thinking..."` on instance or agent config)
3. Send error feedback to user when agent dispatch fails (instead of silent failure)
4. Fix `mentionedJids` matching for LID-based WhatsApp instances

**Acceptance criteria:**
- User receives immediate acknowledgment (reaction or text) when message is dispatched to agent
- If agent errors/times out, user receives error message
- LID-format mentions detected correctly in groups

**Validation:**
```bash
cd /home/genie/agents/namastexlabs/omni/repos/omni && \
bun test && \
grep -rq "agentAckMessage\|ackMessage\|auto.ack" packages/api/src/ packages/core/src/ && \
grep -rq "error.*feedback\|error.*message.*user\|sendErrorFeedback" packages/api/src/ packages/core/src/ && \
echo "PASS"
```

**depends-on:** none

---

### Group 4: Channel Error Standardization (P1)
**Goal:** Migrate all channel error classes to extend core `ChannelError`. GH#81.

**Deliverables:**
1. Migrate Discord error class to extend `ChannelError` from `@omni/core`
2. Migrate WhatsApp error class to extend `ChannelError` from `@omni/core`
3. Migrate Slack error class to extend `ChannelError` — standardize `retryable` → `recoverable`
4. Add `TelegramError extends ChannelError` for Telegram channel
5. Map local error code enums to core `ErrorCode`
6. Delete local error classes after migration — no aliases, clean cut (existing catch blocks use `instanceof` which works with subclasses)

**Acceptance criteria:**
- All 4 channels use `ChannelError` or subclass from `@omni/core`
- `retryable` → `recoverable` standardized across all channels
- Telegram has proper error class
- Local error code enums mapped to core `ErrorCode`
- Old local error classes deleted (not aliased)

**Validation:**
```bash
cd /home/genie/agents/namastexlabs/omni/repos/omni && \
bun test && \
grep -rq "extends ChannelError" packages/channel-discord/src/ && \
grep -rq "extends ChannelError" packages/channel-whatsapp/src/ && \
grep -rq "extends ChannelError" packages/channel-slack/src/ && \
grep -rq "extends ChannelError" packages/channel-telegram/src/ && \
echo "PASS"
```

**depends-on:** none

---

### Group 5: WhatsApp @name Mention Resolver (P2)
**Goal:** Allow agents to use `@name` syntax instead of raw JIDs in WhatsApp messages. GH#209.

**Deliverables:**
1. Add mention resolver that:
   - Accepts `@name` syntax in message text
   - Looks up contact/participant by display name or alias
   - Replaces with correct JID for WhatsApp's `mentionedJid` field
   - Falls back to literal text if no match found
2. Wire resolver into `omni send` CLI and API send endpoint

**Acceptance criteria:**
- `omni send --text "@cezar hello"` resolves `@cezar` to the correct WhatsApp JID
- `mentionedJid` array populated correctly in outbound message
- Unresolvable names left as plain text (no error)

**Validation:**
```bash
cd /home/genie/agents/namastexlabs/omni/repos/omni && \
bun test && \
grep -rq "mentionedJid\|resolveMention\|mention.*resolve" packages/channel-whatsapp/src/ && \
echo "PASS"
```

**depends-on:** Group 3 (shares WhatsApp send path — coordinate on `mentionedJids` handling)

---

### Group 6: Genie Provider Auto-Spawn Fix (P2)
**Goal:** Fix tmux session spawning from PM2 context and add cache health checks. GH#202 + GH#208.

**Deliverables:**
1. Pass tmux session target explicitly when calling `genie team ensure` from the API process
2. Use `tmux new-window -t <session>` directly instead of relying on `TMUX` env var
3. Verify session is actually running — don't report success if `leadSessionId` is still `"pending"`
4. Add TTL or periodic health check to `knownTeams` cache (re-verify every 5 minutes via `tmux has-session`)
5. Strip trailing dashes from sanitized team names
6. Add eviction to prevent unbounded Set growth

**Acceptance criteria:**
- `genie team ensure` creates tmux window even when called from non-tmux process (PM2)
- Dead tmux sessions trigger re-spawn on next message
- knownTeams cache entries expire after 5 minutes
- No trailing dashes in team names

**Validation:**
```bash
cd /home/genie/agents/namastexlabs/omni/repos/omni && \
bun test && \
grep -rq "tmux.*new-window\|tmux.*session" packages/core/src/providers/genie-client.ts && \
grep -rq "TTL\|ttl\|expir\|health.*check\|has-session" packages/core/src/providers/genie-client.ts && \
echo "PASS"
```

**depends-on:** none

---

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Automation fix is too simple (two lines) — might miss edge cases | Medium | Test with real NATS events, not just unit tests |
| CLI short ID resolution could conflict with phone number format | Low | Short IDs are hex UUIDs, phone numbers are numeric — no ambiguity |
| Auto-ack message could confuse users if agent responds fast | Low | Make configurable, default off for instances with fast agents |
| ChannelError migration could break existing error handling | Medium | `instanceof` works with subclasses, so catch blocks still match. Delete old classes cleanly — no aliases. |
| Genie tmux spawn fix requires system-level testing | Medium | Test in actual PM2 + tmux environment, not just unit tests |
