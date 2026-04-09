---
slug: fix-dm-context-and-quoted-truncation
title: "Enable DM context messages and increase quoted text limit"
status: ready
github_issue: 223
priority: P1
---

## Problem

Agents in DMs lack conversation context and cannot see long quoted messages (>500 chars), causing amnesia and forcing users to repeat themselves.

### Issue 1: `buildContextMessages()` effectively returns empty for DMs

In `packages/api/src/plugins/agent-dispatcher.ts` (line 1580), the function finds the last bot message and returns `[]` when `lastBotMessageIndex === 0` (line 1614). In a DM, the typical message flow is: user message -> bot response -> user message. When the user sends a new message, the bot's last response is the most recent message in the DB (index 0 in the desc-ordered list), so the function always early-returns `[]`.

This means the agent never sees messages injected outside its session (e.g., via `omni send` from terminal or other agents). Additionally, the `groupHistorySize` config field name and API description are group-specific, even though context is useful for DMs too.

The issue description references a `chat.chatType !== 'group'` guard that no longer exists in the current code (possibly removed by a prior hotfix), but the `lastBotMessageIndex === 0` early return still effectively blocks DM context.

### Issue 2: `resolveQuotedMessage()` truncates to 500 chars

In the same file (line 764), quoted message content is truncated to 500 characters. Typical agent responses (discovery reports, summaries, code blocks) are 1000-4000+ characters. The agent loses critical context from its own previous messages when a user replies to one.

### Impact

- Agent appears to have amnesia in DMs -- cannot see messages sent via `omni send` or other tools
- Replying to a long agent message only shows a truncated fragment
- Users must repeat context that the agent should already know
- Particularly bad for claude-code provider where sessions persist but external messages are invisible

## Acceptance Criteria

- [ ] `buildContextMessages()` returns recent conversation history for DM chats (not just groups)
- [ ] DM context uses a smaller window (cap at 20 messages) to keep context focused
- [ ] DM context includes messages from BOTH sides (user + bot), not just messages-since-last-bot-response
- [ ] Group chat context behavior is unchanged (messages since last bot response, uses full `groupHistorySize`)
- [ ] `resolveQuotedMessage()` truncation limit increased from 500 to 4000 characters
- [ ] Existing tests pass without modification
- [ ] New unit tests cover DM context behavior
- [ ] New unit tests cover the 4000-char quoted text limit

## Execution Groups

### Group 1: Increase quoted text truncation limit

**Files:** `packages/api/src/plugins/agent-dispatcher.ts`

**Changes:**
- Line 764: Change `const maxLen = 500;` to `const maxLen = 4000;`

This is a one-line change with zero risk of side effects. The quoted text is injected as a `[Quoting sender at time: ...]` prefix in the user message, so increasing the limit just gives the agent more context from the referenced message.

**Tests:** Add test in `packages/api/src/plugins/__tests__/agent-dispatcher.test.ts`:
- Test that `resolveQuotedMessage` returns full text when content is under 4000 chars
- Test that content over 4000 chars is truncated with `...` suffix
- Test that the old 500-char limit no longer applies (a 1000-char message should NOT be truncated)

### Group 2: Enable DM context in `buildContextMessages()`

**Files:** `packages/api/src/plugins/agent-dispatcher.ts`

**Changes:**

1. **Look up chat type** (line ~1592): After the `findByExternalIdSmart` call, use the chat's `chatType` to branch logic. The `if (!chat)` guard stays as-is.

2. **Apply DM-specific history limit** (line ~1599-1602): For DM chats, cap the history limit at 20 regardless of `groupHistorySize`:
   ```typescript
   const effectiveLimit = chat.chatType === 'group' ? historyLimit : Math.min(historyLimit, 20);
   ```
   Use `effectiveLimit` in the `services.messages.list()` call instead of `historyLimit`.

3. **Branch context selection by chat type** (lines ~1610-1622): Replace the current linear flow with a chatType branch:

   **For DMs (`chat.chatType !== 'group'`):**
   - Include ALL recent messages (from both user and bot), excluding the current message IDs
   - Do NOT early-return when `lastBotMessageIndex === 0` -- in DMs, bot messages ARE the context
   - This ensures messages sent via `omni send` or other agents are visible

   **For groups (existing behavior preserved):**
   - Keep the `lastBotMessageIndex` check and `slice(0, lastBotMessageIndex)` logic unchanged
   - Keep the `lastBotMessageIndex === -1 || lastBotMessageIndex === 0` early return

   Concrete diff for lines 1610-1626:
   ```typescript
   const lastBotMessageIndex = recentMessages.findIndex((msg) => msg.isFromMe === true);
   const currentMessageIdSet = new Set(currentMessageIds.filter(Boolean));
   let contextMsgs: typeof recentMessages;

   if (chat.chatType !== 'group') {
     // DMs: include recent messages from BOTH sides (user + bot)
     // This ensures the agent sees messages sent outside its own session
     // (e.g., via `omni send` from terminal or other agents)
     contextMsgs = recentMessages
       .filter((msg) => !currentMessageIdSet.has(msg.externalId));
   } else {
     // Groups: only include messages since last bot response (existing behavior)
     if (lastBotMessageIndex === -1 || lastBotMessageIndex === 0) {
       return [];
     }
     contextMsgs = recentMessages
       .slice(0, lastBotMessageIndex)
       .filter((msg) => !currentMessageIdSet.has(msg.externalId));
   }
   ```

   Note: the `currentMessageIdSet` declaration (currently at line 1619) moves up before the branch. The existing lines 1619-1622 become the `else` branch.

4. **Update the comment on line 1577** to reflect that context is now provided for both group and DM conversations (the docstring already says this, so no change needed).

**Tests:** Add tests in `packages/api/src/plugins/__tests__/agent-dispatcher.test.ts`:

Since `buildContextMessages` is not exported, tests need to go through the dispatch flow or the function needs to be exported for testing. Recommended approach: add a `__test__` export or test indirectly via `processAgentResponse`. Specific test cases:

- **DM with bot messages**: Given a DM chat with [user, bot, user(current)], context should include the bot message
- **DM with external messages**: Given a DM with [user, bot, omni-send-msg, user(current)], context should include both the bot message and the omni-send message
- **DM with only user messages**: Given a DM with [user, user(current)], context should include the first user message
- **DM history cap**: Given a DM with 50 messages in DB, only the 20 most recent (excluding current) should be returned
- **DM with groupHistorySize=0**: Should still return `[]` (disabled)
- **Group unchanged**: Given a group chat, behavior should match the current implementation (messages since last bot response only)

### Group 3: Update API description for `groupHistorySize`

**Files:** `packages/api/src/routes/v2/instances.ts`

**Changes:**
- Line 131-133: Update the `.describe()` text from `'Number of context messages to include for group chats when dispatching to agent (0 = disabled, max 200)'` to `'Number of context messages to include when dispatching to agent. Groups use the full value; DMs are capped at 20. (0 = disabled, max 200)'`

This is documentation-only; no schema or DB changes needed. The field name `groupHistorySize` stays the same for backward compatibility.

**Tests:** None needed (description-only change).

## Dependencies

- Group 1 (quoted truncation) is fully independent and can be done first or in parallel.
- Group 2 (DM context) is the core fix and can be done independently.
- Group 3 (API docs) should be done after or with Group 2, since it documents the new DM behavior.

## Risks

1. **DM context volume**: Including all recent messages (both sides) in DM context could add more tokens to agent prompts. Mitigated by capping at 20 messages for DMs (vs up to 200 for groups).

2. **Duplicate context**: If the agent provider already has session memory (e.g., Claude Code's session transcript), the DB-sourced context messages may partially duplicate what the provider already knows. This is acceptable -- the provider can deduplicate, and the benefit of seeing `omni send` messages outweighs minor duplication.

3. **Quoted text size**: Increasing from 500 to 4000 chars adds up to ~3500 more characters per quoted message to the prompt. For most providers this is negligible. If a message has multiple quoted replies, the total could grow, but the `prependQuotedContext` function only processes one quote per message.

4. **Regression in group behavior**: The group chat path is unchanged (guarded by the `chat.chatType !== 'group'` branch), so existing group behavior should be preserved. Tests should verify this explicitly.

5. **Chat type detection**: The `chat.chatType` field from the database may not always be populated correctly for all platforms. However, `findByExternalIdSmart` is already used elsewhere in the codebase and the `chatType` field is set during chat creation, so this is low risk.

## Validation

```bash
# Group 1 — quoted text limit
bun test packages/api/src/plugins/__tests__/agent-dispatcher.test.ts

# Group 2 — DM context
bun test packages/api/src/plugins/__tests__/agent-dispatcher.test.ts

# Full suite — verify no regressions
make test
make check
```
