# Investigation: Message Persistence Issues (Issues 2 & 3)

**Date:** 2026-02-10  
**Instance:** 5511986780008 (whatsapp-baileys), instance ID: 71b5dc10-c454-4404-a909-5f76b9367208  
**Production:** https://felipe.omni.namastex.io (10.114.1.140, user: omni)

---

## 🔴 ROOT CAUSE: NATS Consumer Startup Failure

**Both Issue 2 and Issue 3 share the same root cause: message-persistence and media-processor NATS consumers are failing to start on API startup.**

### Evidence

From PM2 logs (omni-v2-api), starting at 2026-02-10T00:17:43-03:00:

```
"Failed to set up message persistence" → "NatsError: consumer already exists"
"Failed to set up media processor"     → "NatsError: consumer already exists"
```

This repeats across 4+ API restarts (server has ↺12 total restarts). Each restart hits the same error.

### Impact

- **No messages stored since 2026-02-09 20:45 UTC** (~14 hours gap)
- The API keeps running (HTTP is fine, sends work) but the event consumers (message-persistence-received, message-persistence-sent, etc.) never start
- 52,325 inbound messages exist but **only 11 outbound** — all 11 were from phone (captured via `message.received` with `isFromMe=true`), zero from API sends

### Technical Root Cause

In `packages/core/src/events/nats/client.ts`, the `subscribeInternal()` method calls:

```typescript
await jsm.consumers.add(streamName, {
  ...consumerConfig,
  name: consumerName,
});
```

NATS JetStream `consumers.add()` **fails when a durable consumer already exists with different configuration**. When the consumer config changes (e.g., new `filter_subject` pattern, different `max_deliver`, `concurrency`, etc.) between code versions, the old consumer persists in NATS storage and the new one can't be created.

**Fix:** Use `consumers.update()` or `consumers.add()` with `action: 'update'`, or delete+recreate the consumer on startup. The NATS nats.js library supports `consumers.add()` as an upsert when using the correct API — need to check if the version supports it, or wrap with try-catch + delete + re-add.

---

## Issue 2: History Sync Doesn't Capture Recent Messages

### Flow Analysis

1. `omni resync --instance <id> --since 2h` calls `POST /instances/:id/resync`
2. The API creates a `sync_job` record and publishes `sync.started` event
3. `sync-worker` subscribes to `sync.started` and calls `processMessageSync()`
4. For WhatsApp, `buildWhatsAppAnchors()` queries DB for oldest message per chat
5. It then calls `plugin.fetchHistory()` which uses `sock.fetchMessageHistory()` for each anchor

### Why Resync Returns 0 Messages

**The sync-worker NATS consumer (`sync-worker`) is also likely affected by the same "consumer already exists" error.** Even if the sync-worker starts, the critical issue is:

1. `sock.fetchMessageHistory(count, anchor.messageKey, anchor.timestamp)` triggers **Baileys to request history from WhatsApp servers**
2. WhatsApp responds asynchronously via `messaging-history.set` events
3. The messages from `messaging-history.set` are processed by `handleHistorySync()`
4. If the sync state's `onMessage` callback isn't set (timing issues), messages are emitted as `message.received` events
5. **But `message.received` consumer is dead** → messages are published to NATS but never consumed/stored

**For DMs specifically:** WhatsApp's `fetchMessageHistory()` requires an anchor (an existing message key). If we have no messages stored for a DM chat yet, we can't build an anchor to fetch more. The passive history sync from initial connection is the only path for DMs without prior messages.

### Stuck Sync Job

```
Job 7f8a4023: status=running (created 2026-02-10 11:21:42) — currently stuck
Job 5b548182: status=completed (created 2026-02-10 11:21:05) — this one actually completed
```

The stuck job needs to be marked as failed via direct DB update since the sync-worker consumer isn't running to process it.

---

## Issue 3: Outbound Messages Not Persisted

### Send Flow Trace

1. **API Route** (`messages.ts` → `POST /messages/send`):
   - Resolves recipient, gets plugin, calls `plugin.sendMessage(instanceId, outgoingMessage)`
   - Returns `{ messageId, status: 'sent' }` — **no direct DB write**

2. **WhatsApp Plugin** (`plugin.ts` → `sendMessage()`):
   - Sends via `sock.sendMessage(jid, content)`
   - Tracks the message ID via `trackSentMessageId()` (for echo detection)
   - **Calls `this.emitMessageSent()`** — publishes `message.sent` event to NATS ✅

3. **Message Persistence** (`message-persistence.ts`):
   - Subscribes to `message.sent` events with durable consumer `message-persistence-sent`
   - When it receives the event, creates chat + message record with `isFromMe: true` ✅
   - **BUT: The consumer never started due to "consumer already exists" error** ❌

4. **Echo Prevention** (`handlers/messages.ts` → `shouldProcessMessage()`):
   - When Baileys receives the sent message back as `messages.upsert`:
   - `isBotSentMessage()` returns `true` → message is **skipped** by `message.received` handler
   - This means API-sent messages have **no backup persistence path**

### The Gap

```
API sends message → emitMessageSent() → NATS "message.sent" → 💀 dead consumer → message lost
                                                                    ↕
Baileys echo → shouldProcessMessage() returns false → skipped (correct for loop prevention)
```

**Result:** API-sent messages are successfully delivered to WhatsApp but never stored in the database.

---

## Summary of Findings

### Q: Does `omni send` publish a NATS event that message-persistence picks up?

**YES.** The WhatsApp plugin's `sendMessage()` calls `this.emitMessageSent()` which publishes `message.sent` to NATS JetStream. The `message-persistence.ts` subscribes to `message.sent` with a durable consumer. **However, the consumer fails to start due to "NatsError: consumer already exists"**, so the events are published but never consumed.

### Q: If not, where in the flow should outbound messages be persisted?

The flow is architecturally correct. The fix is making the NATS consumer creation resilient (see fix plan below). As a defense-in-depth measure, the API send route could also write directly to DB (bypassing the event system for sent messages).

### Q: Can Baileys do retroactive message fetch for DMs, or only group history?

**Baileys `fetchMessageHistory()` works for both DMs and groups**, but it requires an **anchor point** — a message key from an existing message. If we have zero stored messages for a chat, there's no anchor to use. The initial history comes passively from WhatsApp's `messaging-history.set` events at connection time, which requires the consumer to be running.

### Q: What's the fix plan for each issue?

See below.

---

## Fix Plan

### Fix 1: NATS Consumer Resilience (ROOT CAUSE — fixes all issues)

**File:** `packages/core/src/events/nats/client.ts`  
**Method:** `subscribeInternal()`

Change consumer creation to handle "already exists" gracefully:

```typescript
// Instead of:
await jsm.consumers.add(streamName, { ...consumerConfig, name: consumerName });

// Do:
try {
  await jsm.consumers.add(streamName, { ...consumerConfig, name: consumerName });
} catch (error) {
  if (String(error).includes('consumer already exists')) {
    // Delete and recreate with new config
    log.warn('Consumer exists with different config, recreating', { consumer: consumerName, stream: streamName });
    try {
      await jsm.consumers.delete(streamName, consumerName);
    } catch (delErr) {
      log.warn('Failed to delete old consumer', { error: String(delErr) });
    }
    await jsm.consumers.add(streamName, { ...consumerConfig, name: consumerName });
  } else {
    throw error;
  }
}
```

**Alternative (cleaner):** NATS nats.js v2.29+ supports `update` action on consumers. Check if the library version supports it:
```typescript
await jsm.consumers.add(streamName, { ...consumerConfig, name: consumerName, action: 'update' });
```

### Fix 2: Immediate Production Recovery

1. **Delete stale NATS consumers** via NATS HTTP monitoring API or by restarting NATS server (will lose JetStream state)
2. **Or:** install `nats` CLI tool and run:
   ```bash
   nats consumer rm MESSAGE message-persistence-received
   nats consumer rm MESSAGE message-persistence-sent
   nats consumer rm MESSAGE message-persistence-delivered
   nats consumer rm MESSAGE message-persistence-read
   nats consumer rm MESSAGE message-persistence-reconnect
   # Also for media processor and event persistence consumers
   ```
3. **Then restart the API:** `pm2 restart omni-v2-api`
4. **Clean stuck sync job:**
   ```sql
   UPDATE sync_jobs SET status = 'failed', error_message = 'Stuck due to consumer failure' 
   WHERE id = '7f8a4023-de45-4414-b2fb-cffc9a61e090' AND status = 'running';
   ```

### Fix 3: Defense-in-Depth for Sent Messages (Optional)

Add a direct DB write in the API send route as a fallback, so sent messages are persisted even if the NATS consumer is down:

```typescript
// In messages.ts send route, after successful plugin.sendMessage():
try {
  const { chat } = await services.chats.findOrCreate(instanceId, resolvedTo, { ... });
  await services.messages.findOrCreate(chat.id, result.messageId, {
    source: 'api',
    messageType: 'text',
    textContent: text,
    isFromMe: true,
    platformTimestamp: new Date(),
  });
} catch (err) {
  // Non-blocking — the NATS consumer is the primary path
  log.warn('Direct sent message persistence failed', { error: String(err) });
}
```

### Fix 4: Also Notable — "received error in ack" (Error 479)

The production logs show hundreds of `"received error in ack"` with error code `479` from WhatsApp for the 5511986780008 instance. Error 479 in WhatsApp typically means **rate limiting** or **too many requests**. The instance may be sending messages too aggressively (the resync/backfill sending read receipts or the bot replying too fast). This should be investigated separately as it may cause message delivery issues.

---

## Production State Summary

| Component | Status |
|-----------|--------|
| PM2 omni-v2-api | Online, 9h uptime, ↺12 restarts |
| PM2 omni-v2-nats | Online, 3D uptime, healthy |
| PM2 omni-v2-pgserve | Online, 3D uptime, healthy |
| NATS consumers | 0 tracked (all failed to start) |
| message-persistence | ❌ Not running since ~00:17 Feb 10 |
| media-processor | ❌ Not running since ~00:17 Feb 10 |
| sync-worker | Likely affected (same NATS issue) |
| Stuck sync job | 7f8a4023 in "running" state |
| Last stored message | 2026-02-09 20:45 UTC |
| Total stored outbound | 11 (all from phone, 0 from API) |
