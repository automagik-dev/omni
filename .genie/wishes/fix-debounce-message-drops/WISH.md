---
slug: fix-debounce-message-drops
title: "Fix debounce message drops in automation + dispatcher paths"
status: ready
github_issue: 225
priority: P1
---

## Problem

When WhatsApp users send rapid sequential messages (very common behavior), debounced messages are silently lost through two independent bugs:

**Bug 1 — Automation path (`extractAgentCallContext` ignores accumulated messages):**
In `packages/core/src/automations/actions.ts`, the function `extractAgentCallContext()` (line 275) builds `AgentCallContext.messages` from a single `context.payload.content` or `context.payload.text` field (line 298), always producing `messages: [messageContent]` (line 312). The engine's `setupDebounceManager()` callback in `engine.ts` (line 256) correctly populates `context.debounce.messages` with all accumulated messages, but `extractAgentCallContext` never reads `context.debounce` — it only reads the last message's payload. All earlier messages in the debounce window are silently discarded.

**Bug 2 — Dispatcher path (`MessageDebouncer.restartTimer` creates orphan batches in `fixed` mode):**
In `packages/api/src/plugins/agent-dispatcher.ts`, class `MessageDebouncer`, method `restartTimer()` (line 295) contains an early return at line 300: `if (config.mode === 'fixed' && existing) return;`. This means once the fixed-window timer fires (e.g. after 2000ms), the window is flushed and the timer/buffer are cleared. Messages arriving after the window fires but before a new stream finishes processing start a NEW debounce window. When that second batch flushes, `resolveStreamingCapabilities()` (line 1219) finds the `streamKey` in `activeStreams` from the first batch's still-running stream and returns `null`. The fallback `dispatchViaProvider` path may also conflict. The net effect: messages in the second batch are either silently dropped or produce an error.

**Impact:** Users sending 4+ rapid messages (typical WhatsApp behavior like "Hi" / "I have a question" / "About my order" / "Order #12345") see only partial context reaching the agent. The agent responds to incomplete information, producing confused or unhelpful replies.

## Acceptance Criteria

- [ ] `extractAgentCallContext()` reads `context.debounce.messages` when present and concatenates all message texts into `AgentCallContext.messages[]`
- [ ] When debounce context is absent, the function falls back to the current single-message behavior (backward compatible)
- [ ] `MessageDebouncer.restartTimer()` in `fixed` mode continues to buffer messages arriving after the timer fires but before the current batch's processing completes (no orphan batches)
- [ ] A user sending 5 rapid messages in a single debounce window sees all 5 messages reach the agent as a single batch
- [ ] A user sending messages that span two fixed windows (e.g., 3 before timer fires, 2 after) sees both groups processed without the second group being blocked by the stream guard
- [ ] Existing debounce tests continue to pass
- [ ] New unit tests cover the multi-message extraction path
- [ ] New unit tests cover the fixed-mode late-arrival scenario

## Execution Groups

### Group 1: Fix `extractAgentCallContext` to use debounce context (automation path)

**Files:**
- `packages/core/src/automations/actions.ts`

**Changes:**
In `extractAgentCallContext()` (line 275-315), after extracting `messageContent` from `context.payload` (line 298), add logic to check for `context.debounce?.messages`:

```typescript
// Current code (line 297-299):
const messageContent = (context.payload.content as string) ?? (context.payload.text as string) ?? '';
if (!messageContent) return { error: 'message content not found in payload' };

// Replace with:
// Build messages array: prefer debounce context (multiple messages), fall back to single payload
let messages: string[];
if (context.debounce?.messages && context.debounce.messages.length > 0) {
  // Debounced path: extract text from all accumulated messages
  messages = context.debounce.messages
    .map((m) => m.text)
    .filter((t): t is string => !!t);
  if (messages.length === 0) {
    return { error: 'no text content found in debounced messages' };
  }
} else {
  // Non-debounced path: single message from payload
  const messageContent = (context.payload.content as string) ?? (context.payload.text as string) ?? '';
  if (!messageContent) return { error: 'message content not found in payload' };
  messages = [messageContent];
}
```

Then update the return statement (line 305-314) to use the new `messages` variable:

```typescript
return {
  context: {
    instanceId,
    providerId: config.providerId ? substituteTemplate(config.providerId, context) : undefined,
    chatId,
    senderId,
    senderName,
    messages,  // was: messages: [messageContent]
  },
};
```

**Tests:**
Add a new test file `packages/core/src/automations/__tests__/actions.test.ts`:

1. **Test: `extractAgentCallContext` with debounce context produces multi-message array**
   - Create a `TemplateContext` with `debounce.messages` containing 3 messages with text
   - Call `executeCallAgentAction` (which calls `extractAgentCallContext` internally) via `executeAction`
   - Verify the `callAgent` dependency receives `messages: ['msg1', 'msg2', 'msg3']`

2. **Test: `extractAgentCallContext` without debounce context falls back to single message**
   - Create a `TemplateContext` with `payload.content = 'hello'` and no `debounce` field
   - Verify `callAgent` receives `messages: ['hello']`

3. **Test: `extractAgentCallContext` with debounce messages where some have no text filters them out**
   - Include messages with `text: undefined` (e.g., image-only messages)
   - Verify only messages with text are included

4. **Test: `extractAgentCallContext` with debounce messages all lacking text returns error**
   - All messages have `text: undefined`
   - Verify the action returns `{ success: false, error: 'no text content found in debounced messages' }`

### Group 2: Fix `MessageDebouncer.restartTimer` for fixed-mode late arrivals (dispatcher path)

**Files:**
- `packages/api/src/plugins/agent-dispatcher.ts`

**Changes:**
The root issue is that in `fixed` mode, once the timer fires and the buffer is flushed, messages arriving during processing start a brand-new debounce window. When that window flushes, the `activeStreams` guard blocks it because the first batch is still streaming.

The fix has two parts:

**Part A — Remove the early return, use anchored-delay instead (line 295-321):**

Replace the `restartTimer` method:

```typescript
private restartTimer(chatKey: string, config: DebounceConfig): void {
  const existing = this.timers.get(chatKey);

  // In 'fixed' mode, the timer is anchored to the first message's arrival.
  // Do NOT clear/restart it — just let new messages accumulate in the buffer.
  if (config.mode === 'fixed' && existing) return;

  if (existing) clearTimeout(existing);

  let delay: number;
  switch (config.mode) {
    case 'disabled':
      delay = 0;
      break;
    case 'fixed':
      delay = config.minMs;
      break;
    case 'randomized':
      delay = config.minMs + Math.random() * (config.maxMs - config.minMs);
      break;
    default:
      delay = 0;
  }

  const timer = setTimeout(() => this.flush(chatKey), delay);
  this.timers.set(chatKey, timer);
}
```

The `restartTimer` logic itself is actually correct for its intended purpose (fixed window from first message). The real problem is what happens to messages arriving AFTER `flush()` runs but WHILE the agent is still processing the flushed batch.

**Part B — Hold-back buffer for in-flight processing (line 266-342):**

Add an `inFlight` set to `MessageDebouncer` to track chat keys currently being processed. When `buffer()` is called for a chat key that is in-flight, buffer the message but do NOT start a new timer yet. When `onFlush` completes, check if new messages accumulated and re-flush them.

```typescript
class MessageDebouncer {
  private buffers: Map<string, BufferedMessage[]> = new Map();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private inFlight: Set<string> = new Set();
  private onFlush: (chatKey: string, messages: BufferedMessage[]) => Promise<void>;

  constructor(onFlush: (chatKey: string, messages: BufferedMessage[]) => Promise<void>) {
    this.onFlush = onFlush;
  }

  private getChatKey(instanceId: string, chatId: string): string {
    return `${instanceId}:${chatId}`;
  }

  buffer(instanceId: string, chatId: string, message: BufferedMessage, config: DebounceConfig): void {
    const chatKey = this.getChatKey(instanceId, chatId);
    const buffer = this.buffers.get(chatKey) ?? [];
    buffer.push(message);
    this.buffers.set(chatKey, buffer);

    // If this chat is currently being processed, just accumulate — don't start
    // a new timer. The flush completion handler will pick up these messages.
    if (this.inFlight.has(chatKey)) return;

    this.restartTimer(chatKey, config);
  }

  // ... onUserTyping stays the same ...

  private restartTimer(chatKey: string, config: DebounceConfig): void {
    // unchanged from current implementation
    const existing = this.timers.get(chatKey);
    if (config.mode === 'fixed' && existing) return;
    if (existing) clearTimeout(existing);

    let delay: number;
    switch (config.mode) {
      case 'disabled':
        delay = 0;
        break;
      case 'fixed':
        delay = config.minMs;
        break;
      case 'randomized':
        delay = config.minMs + Math.random() * (config.maxMs - config.minMs);
        break;
      default:
        delay = 0;
    }

    const timer = setTimeout(() => this.flush(chatKey), delay);
    this.timers.set(chatKey, timer);
  }

  private async flush(chatKey: string): Promise<void> {
    const messages = this.buffers.get(chatKey);
    this.buffers.delete(chatKey);
    this.timers.delete(chatKey);

    if (!messages?.length) return;

    this.inFlight.add(chatKey);
    try {
      await this.onFlush(chatKey, messages);
    } catch (error) {
      log.error('Error flushing debounced messages', { chatKey, error: String(error) });
    } finally {
      this.inFlight.delete(chatKey);

      // Check if new messages arrived while we were processing.
      // If so, flush them now (they've been accumulating in the buffer).
      const pending = this.buffers.get(chatKey);
      if (pending?.length) {
        // Use setImmediate/setTimeout(0) to avoid deep recursion
        setTimeout(() => this.flush(chatKey), 0);
      }
    }
  }

  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.buffers.clear();
    this.timers.clear();
    this.inFlight.clear();
  }
}
```

**Tests:**
These tests should be added inline in a new test file or co-located with existing dispatcher tests. Since the `MessageDebouncer` class is private to the module, the cleanest approach is to extract it to a separate file or test it via integration-style tests. Given the class is local to the file, write focused unit tests by copying the class into a test harness:

Add test file `packages/api/src/plugins/__tests__/message-debouncer.test.ts`:

1. **Test: fixed mode — messages arriving during in-flight processing are not lost**
   - Buffer 2 messages, let the fixed timer fire
   - While `onFlush` is running (use a delayed promise), buffer 2 more messages
   - Verify `onFlush` is called twice: first with 2 messages, then with the 2 late arrivals
   - Verify all 4 messages are accounted for

2. **Test: fixed mode — messages arriving during in-flight are NOT sent to a competing stream**
   - Verify that `buffer()` called while `inFlight` has the chatKey does NOT call `restartTimer`
   - This prevents a second timer from firing while the first batch is still streaming

3. **Test: disabled mode — immediate flush still works**
   - `mode: 'disabled'`, messages should flush with delay=0
   - Verify backward compatibility

4. **Test: randomized mode — timer restart works as before**
   - Verify the existing restart-on-new-message behavior is preserved

5. **Test: clear() also clears inFlight set**

### Group 3: Exportability of `MessageDebouncer` for testing

**Files:**
- `packages/api/src/plugins/agent-dispatcher.ts`

**Changes:**
Consider exporting `MessageDebouncer` class (or extracting it to a dedicated file like `packages/api/src/plugins/message-debouncer.ts`) so it can be directly unit-tested without duplicating the class in tests.

If extracting:
- Move `MessageDebouncer`, `BufferedMessage`, and `DebounceConfig` (the dispatcher-local one) to `packages/api/src/plugins/message-debouncer.ts`
- Re-export from `agent-dispatcher.ts` (or import in both files)
- Update test imports

This is optional but strongly recommended for testability.

**Tests:**
- Verify existing agent-dispatcher behavior is unchanged (smoke test / existing integration tests if any)

## Dependencies

- **Group 1 is fully independent of Group 2.** They fix different bugs in different packages and can be developed and merged in parallel.
- **Group 3 should be done before or alongside Group 2** if we want clean unit tests for the dispatcher debouncer. If skipped, Group 2 tests can duplicate the class definition in the test file.
- Both fixes should ship together in a single PR since the issue describes them as one bug report, but they can be separate commits.

## Risks

1. **Backward compatibility of `extractAgentCallContext` (Group 1):** The `AgentCallContext.messages` field already accepts `string[]`. Any downstream consumer that reads `messages[0]` will still work. Consumers that join all messages (e.g., `messages.join('\n')`) will now get the full conversation context. Risk is low but verify all `callAgent` implementations handle multi-element `messages` arrays correctly.

2. **Re-flush timing in Group 2:** The `setTimeout(() => this.flush(chatKey), 0)` re-flush uses a zero-delay timer. If the agent response is very fast (< debounce window), the re-flush might fire before all late messages arrive. This is acceptable because it matches the existing debounce contract: messages arriving after a flush belong to a new window. The `inFlight` guard only protects against the specific race where messages arrive DURING processing.

3. **Memory leak in `inFlight` set (Group 2):** If `onFlush` throws and the `finally` block somehow doesn't execute (should not happen in practice), a chatKey could remain in `inFlight` forever. The `clear()` method resets it, mitigating this on shutdown.

4. **Test flakiness:** Debounce tests rely on real timers (`setTimeout`). Tests should use generous delays (2-3x the debounce window) to avoid CI flakiness. Consider using fake timers if the test framework supports them (`bun:test` has limited fake timer support).

5. **Dispatcher `DebounceConfig` vs Core `DebounceConfig`:** These are two different types with different fields (dispatcher uses `minMs/maxMs/mode:'fixed'|'disabled'|'randomized'`; core uses `delayMs/mode:'fixed'|'none'|'range'|'presence'`). Changes to one do not affect the other. Be careful not to confuse them during implementation.

## Validation

```bash
# Group 1 — automation path fix
bun test packages/core/src/automations/__tests__/actions.test.ts
bun test packages/core/src/automations/__tests__/debounce.test.ts

# Group 2 — dispatcher path fix
bun test packages/api/src/plugins/__tests__/message-debouncer.test.ts

# Full suite — verify no regressions
make test
make check
```
