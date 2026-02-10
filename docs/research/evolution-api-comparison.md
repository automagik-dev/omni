# Evolution API vs Omni — Baileys Strategy Comparison

> **Date:** 2026-02-10
> **Context:** Omni's resync/backfill is getting WhatsApp error 479 (rate limit) because `fetchMessageHistory` fires every 300ms.
> **Goal:** Understand how Evolution API handles delays, rate limiting, history sync, and message persistence — and what Omni should adopt.

---

## 1. Executive Summary

**The core finding:** Evolution API does **NOT** use `fetchMessageHistory` at all for production backfill. They rely entirely on Baileys' **passive history sync** (`messaging-history.set` events triggered by `shouldSyncHistoryMessage` + `syncFullHistory`). This is why they don't hit error 479 — they never actively request message history.

Omni's approach of calling `fetchMessageHistory` per-chat with 300ms delays is fundamentally different from how Evolution API (and likely WhatsApp itself) expects history to be consumed. The 479 error is WhatsApp telling us we're requesting too much too fast.

**Key differences:**
| Aspect | Evolution API | Omni |
|--------|--------------|------|
| History sync | Passive (WhatsApp pushes) | Active (`fetchMessageHistory` per chat) |
| `fetchMessageHistory` usage | Only for manual on-demand (debug) | Core resync strategy |
| Send message delays | Caller-provided `delay` param (presence-based) | Built-in `humanDelay` (1.5-3.5s random) |
| Message persistence | Explicit `prisma.create` after send | Event-based via `message.sent` event bus |
| Event processing | Sequential queue (`eventProcessingQueue`) | Per-event handler (`sock.ev.on`) |
| Rate limiting for sync | None needed (passive) | 30 req/min RateLimiter (but 300ms between fetches) |
| Baileys version | `baileys@7.0.0-rc.9` | `@whiskeysockets/baileys@^7.0.0-rc.9` |

---

## 2. Evolution API Architecture Overview

### 2.1 Baileys Socket Configuration

**File:** `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts`, lines 640-700

```typescript
const socketConfig = {
  version,
  logger: P({ level: this.logBaileys }),
  auth: { creds, keys: makeCacheableSignalKeyStore(...) },
  msgRetryCounterCache: this.msgRetryCounterCache,
  generateHighQualityLinkPreview: true,
  retryRequestDelayMs: 350,           // ← Omni doesn't set this
  maxMsgRetryCount: 4,                // ← Omni doesn't set this
  fireInitQueries: true,              // ← Omni doesn't set this
  connectTimeoutMs: 30_000,           // Omni: 60_000
  keepAliveIntervalMs: 30_000,        // Omni: 25_000
  qrTimeout: 45_000,                  // ← Omni doesn't set this
  emitOwnEvents: false,               // ← CRITICAL: Omni doesn't set this
  syncFullHistory: this.localSettings.syncFullHistory,
  shouldSyncHistoryMessage: (msg) => this.historySyncNotification(msg),
  shouldIgnoreJid: (jid) => { ... },  // Ignores groups/broadcasts/newsletters per settings
  cachedGroupMetadata: this.getGroupMetadataCache,
  userDevicesCache: this.userDevicesCache,
  transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },
  patchMessageBeforeSending(message) { ... },
};
```

**Key options Omni is missing:**

| Option | Evolution API | Omni | Impact |
|--------|--------------|------|--------|
| `retryRequestDelayMs` | `350` | Not set (Baileys default) | Controls retry delay for failed requests |
| `maxMsgRetryCount` | `4` | Not set (Baileys default) | Max retries for failed message sends |
| `fireInitQueries` | `true` | Not set (Baileys default) | Fires initial queries on connect |
| `emitOwnEvents` | `false` | Not set (`true` default) | **CRITICAL**: When true, Baileys re-emits sent messages as `messages.upsert` — may cause echo issues |
| `qrTimeout` | `45_000` | Not set | QR code timeout |
| `shouldIgnoreJid` | Configured | Not set | Filters out newsletters, broadcasts |
| `transactionOpts` | `{maxCommitRetries: 10, delayBetweenTriesMs: 3000}` | Not set | Signal key store transaction retry |
| `patchMessageBeforeSending` | Fixes list type | Not set | Workaround for Baileys bug |
| `cachedGroupMetadata` | Set | Not set | Avoids re-fetching group metadata |
| `userDevicesCache` | NodeCache (5min TTL) | Not set | Caches user device info |

### 2.2 Event Processing Architecture

**File:** `whatsapp.baileys.service.ts`, lines 1876-1877

Evolution API uses a **sequential event processing queue** via `client.ev.process()`:

```typescript
private eventProcessingQueue: Promise<void> = Promise.resolve();

private eventHandler() {
  this.client.ev.process(async (events) => {
    this.eventProcessingQueue = this.eventProcessingQueue.then(async () => {
      // Process ALL events in sequence
      if (events['messaging-history.set']) { ... }
      if (events['messages.upsert']) { ... }
      if (events['messages.update']) { ... }
      // ... all other events
    });
  });
}
```

**Omni's approach:** Uses individual `sock.ev.on()` handlers for each event type (in `handlers/messages.ts` and `handlers/all-events.ts`). This means events can be processed concurrently, which could lead to race conditions.

### 2.3 BaileysMessageProcessor (RxJS-based)

**File:** `baileysMessage.processor.ts`

Evolution has a separate `BaileysMessageProcessor` class using RxJS `Subject` with `concatMap` (sequential processing), automatic retry (3 attempts with 1s delay), and error recovery. **However, this is currently commented out** in the event handler (line 1924: `// this.messageProcessor.processMessage(payload, settings);`). They process messages inline instead.

---

## 3. Delay / Rate Limiting Strategy Comparison

### 3.1 Evolution API: No Internal Rate Limiting

**Key finding:** Evolution API has **zero internal rate limiting or delay logic** for WhatsApp API calls.

Their delay mechanism is entirely **caller-driven** — the API consumer passes a `delay` parameter in the send request DTO:

```typescript
// SendTextDto, SendMediaDto, etc. all have:
{ delay?: number }  // milliseconds

// Used in sendMessageWithTyping() (line 2306):
if (options?.delay) {
  await this.client.presenceSubscribe(sender);
  await this.client.sendPresenceUpdate('composing', sender);
  await delay(options.delay);  // Uses Baileys' built-in delay()
  await this.client.sendPresenceUpdate('paused', sender);
}
```

For delays > 20 seconds, they chunk into 20s segments with composing/paused cycles (lines 2308-2335).

**There is no:**
- Message send queue
- Rate limiter
- Exponential backoff
- Automatic anti-ban delays
- Random jitter between sends

### 3.2 Omni: Built-in humanDelay

**File:** `packages/channel-whatsapp/src/plugin.ts`, lines 250-265

```typescript
private async humanDelay(instanceId: string): Promise<void> {
  const now = Date.now();
  const last = this.lastActionTime.get(instanceId) || 0;
  const minDelay = 1500;  // 1.5 seconds
  const maxDelay = 3500;  // 3.5 seconds
  const randomDelay = minDelay + Math.random() * (maxDelay - minDelay);
  const elapsed = now - last;

  if (elapsed < randomDelay) {
    await new Promise<void>((r) => setTimeout(r, randomDelay - elapsed));
  }
  this.lastActionTime.set(instanceId, Date.now());
}
```

Called before **every** outgoing action (sendMessage, react, markRead, etc.). This is more protective than Evolution API, but may be unnecessarily aggressive for some operations.

### 3.3 History Fetch Rate Limiting

**Evolution API:** No rate limiting needed — they don't actively fetch history.

**Omni:** Two layers of rate limiting exist but conflict:

1. **`sync-worker.ts` RateLimiter** (line 37-48): Token bucket at 30 req/min for WhatsApp (~2s interval). Applied to `onMessage` callback, NOT to `fetchMessageHistory` calls.

2. **`plugin.ts` fetchAllAnchors** (line 1158): Fixed 300ms delay between `fetchMessageHistory` calls per anchor. **This is the source of error 479.**

```typescript
// plugin.ts line 1155-1160:
await sock.fetchMessageHistory(count, anchor.messageKey, anchor.timestamp);
await new Promise((resolve) => setTimeout(resolve, 300)); // ← TOO FAST
```

The 300ms delay allows ~200 requests/minute to WhatsApp's history endpoint, which triggers rate limiting (error 479).

---

## 4. History Sync Comparison

### 4.1 Evolution API: Passive-Only Strategy

**File:** `whatsapp.baileys.service.ts`

Evolution API relies entirely on Baileys' built-in passive sync:

1. **Socket config** (line 670-673):
   ```typescript
   syncFullHistory: this.localSettings.syncFullHistory,
   shouldSyncHistoryMessage: (msg) => this.historySyncNotification(msg),
   ```

2. **`historySyncNotification()`** (line 2015-2028): Always returns `true`, allowing all history sync types:
   ```typescript
   private historySyncNotification(msg) {
     // Chatwoot integration hooks (if enabled)
     return true;  // Always accept
   }
   ```

3. **Sync type filtering** (line 2040-2041):
   ```typescript
   // Type 2 = FULL history sync
   // Type 3 = RECENT (lightweight) sync
   (this.localSettings.syncFullHistory && msg?.syncType === 2) ||
   (!this.localSettings.syncFullHistory && msg?.syncType === 3)
   ```

4. **`messaging-history.set` handler** (lines 927-1060): Processes batches of messages/chats/contacts as they arrive from WhatsApp. No delays, no throttling — just processes what WhatsApp sends.

5. **`fetchMessageHistory` usage** (line 1117): Only triggered when a user sends the literal text `"onDemandHistSync"` as a WhatsApp message — clearly a debug/test feature, not production:
   ```typescript
   if (text == 'onDemandHistSync') {
     const messageId = await this.client.fetchMessageHistory(50, received.key, received.messageTimestamp!);
     console.log('requested on-demand sync, id=', messageId);
   }
   ```

### 4.2 Omni: Active + Passive Strategy

Omni uses both passive sync AND active `fetchMessageHistory`:

1. **Passive** (via `handlers/all-events.ts`): `messaging-history.set` events are forwarded to `plugin.handleHistorySync()`.

2. **Active** (via `plugin.ts` `fetchHistory()`): Builds anchors from DB (oldest message per chat), then calls `fetchMessageHistory` per anchor with recursive pagination.

3. **Triggered by sync-worker** (via `sync-worker.ts`): On `sync.started` events, builds anchors and calls `fetchHistory()`.

4. **Post-reconnect backfill** (via `message-persistence.ts`): Detects gaps > 5 minutes on `instance.connected` and auto-triggers a message sync job.

**The problem flow:**
```
instance.connected → gap detected → sync.started event
  → sync-worker picks up → buildWhatsAppAnchors()
  → fetchHistory() with anchors → fetchAnchorsHistory()
  → fetchAllAnchors() → for each anchor:
     fetchMessageHistory(100, ...) + 300ms delay
  → If 100 results returned, recursively fetch more (depth++)
  → 479 error from WhatsApp
```

### 4.3 How WhatsApp History Actually Works

Understanding the WhatsApp protocol helps explain why Evolution's approach works:

1. **On initial connection** with `syncFullHistory: true`: WhatsApp phone pushes history in chunks via `messaging-history.set`. This is rate-controlled by the phone, not the server.

2. **`fetchMessageHistory()`**: This is an **on-demand** API that requests specific message ranges. WhatsApp rate-limits this aggressively because it's not the intended flow for bulk history.

3. **The intended flow for backfill**: Just wait for `messaging-history.set` events after reconnection. WhatsApp automatically pushes missed messages.

---

## 5. Message Persistence Comparison

### 5.1 Evolution API: Explicit Persistence After Send

**File:** `whatsapp.baileys.service.ts`, lines 2459-2461

```typescript
// After calling this.sendMessage():
if (this.configService.get<Database>('DATABASE').SAVE_DATA.NEW_MESSAGE) {
  const msg = await this.prismaRepository.message.create({ data: messageRaw });
  // ... handle S3 upload for media
}
```

**Key points:**
- Sent messages are persisted **immediately** after `sendMessage()` returns, in the same function.
- `emitOwnEvents: false` means Baileys does NOT re-emit sent messages as `messages.upsert`. This avoids the echo problem entirely.
- Configurable via `SAVE_DATA.NEW_MESSAGE` flag.

### 5.2 Omni: Event-Based Persistence

**File:** `packages/api/src/plugins/message-persistence.ts`

Omni uses event-driven persistence:

1. **Sent messages** are tracked via `plugin.trackSentMessageId()` and emitted as `message.sent` events.
2. **`message-persistence.ts`** subscribes to `message.sent` and creates the DB record.
3. **Echo detection** uses `isBotSentMessage()` to skip re-processing of sent message echoes from `messages.upsert`.

**Potential issue:** Since Omni doesn't set `emitOwnEvents: false`, Baileys will emit sent messages back as `messages.upsert` events. Omni handles this with `isBotSentMessage()`, but it's an extra unnecessary step.

### 5.3 History Sync Persistence

**Evolution API:**
- `messaging-history.set` handler persists directly via `prisma.message.createMany({ skipDuplicates: true })` (line 1040).
- Uses a `messagesRepository` Set to deduplicate (line 1018-1026).
- Controlled by `SAVE_DATA.HISTORIC` config flag.

**Omni:**
- `handleHistorySync()` processes messages in batches of 50 (`Promise.all`).
- For explicit fetch jobs: uses sync callback (`syncState.onMessage`).
- For passive sync (no active job): calls `emitMessageReceived()` which publishes `message.received` events to NATS, then `message-persistence.ts` picks them up.
- This means passive history sync goes through the full event pipeline: `messaging-history.set` → `handleHistorySync` → `emitMessageReceived` → NATS → `message-persistence`.

---

## 6. Recommendations for Omni

### 6.1 🔴 Critical: Fix `fetchMessageHistory` Rate Limiting (Error 479)

**Root cause:** 300ms delay between `fetchMessageHistory` calls is too aggressive.

**Recommended fix — Option A (Preferred): Remove Active Fetching**

Follow Evolution API's approach: **do not call `fetchMessageHistory` for bulk backfill**. Instead:

1. Set `syncFullHistory: true` (already done).
2. Let WhatsApp push history via `messaging-history.set` events.
3. For post-reconnect gaps, just wait for passive sync — WhatsApp pushes missed messages automatically.
4. Reserve `fetchMessageHistory` only for explicit user-triggered on-demand requests (CLI/API endpoint to backfill a specific chat).

**Recommended fix — Option B (If Active Fetching Is Required):**

If we must keep active fetching:

1. **Increase delay to 5-10 seconds** between `fetchMessageHistory` calls:
   ```typescript
   // Instead of 300ms:
   await new Promise((resolve) => setTimeout(resolve, 5000 + Math.random() * 5000));
   ```

2. **Add exponential backoff on 479 errors:**
   ```typescript
   let backoffMs = 5000;
   try {
     await sock.fetchMessageHistory(count, anchor.messageKey, anchor.timestamp);
     backoffMs = 5000; // Reset on success
   } catch (error) {
     if (error?.output?.statusCode === 479 || String(error).includes('479')) {
       backoffMs = Math.min(backoffMs * 2, 300_000); // Double up to 5 min
       await new Promise((resolve) => setTimeout(resolve, backoffMs));
     }
   }
   ```

3. **Limit concurrent anchors:** Fetch 1 chat at a time, not all anchors in sequence.

4. **Cap total requests per session:** Maximum 10-20 `fetchMessageHistory` calls per connection session.

### 6.2 🟡 Important: Add Missing Socket Options

```typescript
// In socket.ts createSocket():
return makeWASocket({
  // ... existing options ...
  
  // NEW: Prevent Baileys from re-emitting sent messages
  emitOwnEvents: false,
  
  // NEW: Retry configuration
  retryRequestDelayMs: 350,
  maxMsgRetryCount: 4,
  
  // NEW: Signal key store transaction resilience
  transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },
  
  // NEW: Filter out non-conversation JIDs
  shouldIgnoreJid: (jid) => {
    return jid.endsWith('@newsletter') || jid.endsWith('@broadcast');
  },
  
  // NEW: Accept all history sync types
  shouldSyncHistoryMessage: () => true,
  
  // NEW: Cache group metadata (reduces API calls)
  cachedGroupMetadata: async (jid) => {
    // Return from cache or fetch
  },
});
```

### 6.3 🟡 Important: Sequential Event Processing

Evolution API chains all events sequentially via `eventProcessingQueue`. Omni should consider this pattern to avoid race conditions during high-throughput periods:

```typescript
// Instead of individual sock.ev.on() handlers:
sock.ev.process(async (events) => {
  // Process events sequentially in one atomic batch
});
```

### 6.4 🟢 Nice-to-Have: Simplify Echo Detection

If `emitOwnEvents: false` is set:
- `isBotSentMessage()` / `trackSentMessageId()` become unnecessary for echo detection.
- Sent messages are only persisted via the explicit `message.sent` event path.
- Simplifies the code and removes the Map + TTL cleanup logic.

### 6.5 🟢 Nice-to-Have: Post-Reconnect Gap Handling

The current `message-persistence.ts` auto-triggers a sync job when a gap > 5 minutes is detected. With passive sync, this is unnecessary — WhatsApp will push missed messages. Consider:

1. Keep gap detection for **logging/alerting** purposes.
2. Remove automatic sync job creation for gaps.
3. Only trigger active sync when explicitly requested by user/admin.

### 6.6 Summary of Changes by Priority

| Priority | Change | Files | Effort |
|----------|--------|-------|--------|
| 🔴 P0 | Increase `fetchMessageHistory` delay to 5-10s or remove active fetching | `plugin.ts:1158` | Small |
| 🔴 P0 | Add exponential backoff on 479 errors | `plugin.ts:fetchAllAnchors` | Small |
| 🟡 P1 | Set `emitOwnEvents: false` | `socket.ts` | Small |
| 🟡 P1 | Add `retryRequestDelayMs`, `maxMsgRetryCount`, `transactionOpts` | `socket.ts` | Small |
| 🟡 P1 | Add `shouldIgnoreJid` filter | `socket.ts` | Small |
| 🟡 P1 | Add `shouldSyncHistoryMessage: () => true` | `socket.ts` | Small |
| 🟡 P2 | Switch to `sock.ev.process()` for sequential event handling | `handlers/*.ts` | Medium |
| 🟢 P3 | Remove echo detection code if `emitOwnEvents: false` | `plugin.ts`, `handlers/messages.ts` | Small |
| 🟢 P3 | Make post-reconnect backfill opt-in rather than automatic | `message-persistence.ts` | Small |

---

## Appendix A: File References

### Evolution API
- **Main service:** `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` (5122 lines)
- **Message processor:** `src/api/integrations/channel/whatsapp/baileysMessage.processor.ts` (72 lines)
- **Send controller:** `src/api/controllers/sendMessage.controller.ts` (105 lines)
- **Package:** `baileys@7.0.0-rc.9`

### Omni
- **WhatsApp plugin:** `packages/channel-whatsapp/src/plugin.ts` (2463 lines)
- **Socket wrapper:** `packages/channel-whatsapp/src/socket.ts` (185 lines)
- **Message handlers:** `packages/channel-whatsapp/src/handlers/messages.ts`
- **Event handlers:** `packages/channel-whatsapp/src/handlers/all-events.ts`
- **Sync worker:** `packages/api/src/plugins/sync-worker.ts` (732 lines)
- **Message persistence:** `packages/api/src/plugins/message-persistence.ts` (672 lines)
- **Package:** `@whiskeysockets/baileys@^7.0.0-rc.9`

### Appendix B: Evolution API `messaging-history.set` Handler (Key Section)

```typescript
// Lines 927-1060 — Full handler
'messaging-history.set': async ({ messages, chats, contacts, isLatest, progress, syncType }) => {
  // 1. Log sync progress
  console.log(`recv ${chats.length} chats, ${contacts.length} contacts, ${messages.length} msgs`);
  
  // 2. Persist chats (upsert, skip duplicates)
  await this.prismaRepository.chat.createMany({ data: chatsRaw, skipDuplicates: true });
  
  // 3. Persist messages (skip duplicates via Set)
  // Uses messagesRepository Set for dedup (loaded once from DB)
  if (this.configService.get<Database>('DATABASE').SAVE_DATA.HISTORIC) {
    await this.prismaRepository.message.createMany({ data: messagesRaw, skipDuplicates: true });
  }
  
  // 4. Chatwoot import (batched, deferred via addHistoryMessages)
  
  // 5. Persist contacts
  await this.contactHandle['contacts.upsert'](contacts);
}
```

No delays. No throttling. No rate limiting. Just process what WhatsApp sends.
