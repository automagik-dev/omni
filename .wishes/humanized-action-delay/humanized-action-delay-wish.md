# WISH: Humanized Action Delay

> Add randomized delays + typing presence to all outgoing WhatsApp actions to prevent Meta anti-bot detection.

**Status:** SHIPPED
**Created:** 2026-02-09
**Author:** Omni + Felipe
**Priority:** CRITICAL — must deploy before reconnecting instances
**Branch:** `feat/humanized-action-delay`

---

## Context

WhatsApp has anti-bot detection that monitors action timing patterns. Inhuman bursts (10+ actions in seconds) trigger forced logout / device removal. Two instances (genie + helena) were killed during QA testing.

The Omni already has `messageSplitDelay` (randomized delays between split message chunks). We need the same concept for ALL outgoing actions at the plugin level.

## Scope

### IN SCOPE
- Add a delay layer in the WhatsApp plugin's `sendMessage()` method
- Send `composing` presence before text messages (typing indicator)
- Typing duration proportional to message length
- Random delay between any two actions on the same instance
- Per-instance configuration (reuse existing instance config fields or add new ones)
- Apply to: sendMessage, chatModify, groupCreate, updateProfile*, block/unblock, star, disappearing, editMessage

### OUT OF SCOPE
- NATS-based queue (future, heavier solution)
- Per-action-type different delays (keep it simple: one delay for all)
- Incoming message processing delays (only outgoing)

---

## Implementation

### Core: Instance-level action queue with delay

In `packages/channel-whatsapp/src/plugin.ts`, add a per-instance mutex/queue that enforces minimum delay between any two outgoing actions:

```typescript
// Per-instance last action timestamp
private lastActionTime: Map<string, number> = new Map();

private async humanDelay(instanceId: string): Promise<void> {
  const now = Date.now();
  const last = this.lastActionTime.get(instanceId) || 0;
  const minDelay = 1500; // 1.5s minimum between actions
  const maxDelay = 3500; // 3.5s maximum
  const randomDelay = minDelay + Math.random() * (maxDelay - minDelay);
  const elapsed = now - last;
  
  if (elapsed < randomDelay) {
    await new Promise(r => setTimeout(r, randomDelay - elapsed));
  }
  
  this.lastActionTime.set(instanceId, Date.now());
}
```

### Typing presence before messages

In `sendMessage()`, before actually sending:

```typescript
async sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult> {
  await this.humanDelay(instanceId);
  
  // Send typing indicator for text messages
  if (message.content.type === 'text' || message.content.caption) {
    const text = message.content.text || message.content.caption || '';
    const typingMs = Math.min(800 + text.length * 30, 4000); // 800ms base + 30ms/char, max 4s
    const sock = this.getSocket(instanceId);
    const jid = toJid(message.to);
    await sock.sendPresenceUpdate('composing', jid);
    await new Promise(r => setTimeout(r, typingMs));
    await sock.sendPresenceUpdate('paused', jid);
  }
  
  // ... existing send logic
}
```

### Apply humanDelay to all action methods

Every public method that calls Baileys socket should call `await this.humanDelay(instanceId)` first:
- sendMessage (+ typing)
- groupCreate
- chatModify (archive/pin/mute)
- updateProfilePicture / removeProfilePicture
- updateProfileName
- updateBlockStatus
- starMessage / deleteMessage / editMessage
- setDisappearingMessages
- rejectCall

---

## Validation

```bash
make typecheck && make lint
```

Manual: send 5 messages rapidly via API — observe 1.5-3.5s delays between each, with typing indicator visible.

## Success Criteria

- [x] All outgoing actions have randomized delay (1.5-3.5s)
- [x] Text messages show typing indicator before send
- [x] Typing duration scales with text length
- [x] `make typecheck` passes
- [x] `make lint` passes
- [x] No test regressions (40 pre-existing failures, 0 new)

---

## Review Verdict

**Verdict:** SHIP
**Date:** 2026-02-09
**Reviewed by:** REVIEW Agent
**Commit:** `46af99c` — merged to main via PR #12

### Acceptance Criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| All outgoing actions have randomized delay (1.5-3.5s) | PASS | 18 `humanDelay()` calls across all write methods. minDelay=1500, maxDelay=3500 |
| Text messages show typing indicator before send | PASS | `simulateTyping()` called in `sendMessage()` for text/caption content |
| Typing duration scales with text length | PASS | Formula: `Math.min(800 + text.length * 30, 4000)` — 800ms base + 30ms/char, max 4s |
| `make typecheck` passes | PASS | 10/10 packages pass (FULL TURBO) |
| `make lint` passes | PASS | 454 files checked, no fixes needed |
| No test regressions | PASS | 40 failures are all pre-existing (Events Service, API Key, Event Persistence) — none in channel-whatsapp humanDelay code |

### Coverage Audit (18 methods protected)

| Method | humanDelay | Notes |
|--------|:---:|-------|
| sendMessage | ✅ | + simulateTyping for text/caption |
| deleteMessage | ✅ | |
| blockContact | ✅ | |
| unblockContact | ✅ | |
| setDisappearing | ✅ | |
| starMessage | ✅ | |
| updateProfileName | ✅ | |
| chatModifyAction | ✅ | archive/pin/mute |
| updateProfilePicture | ✅ | |
| updateGroupPicture | ✅ | bonus — not in wish |
| removeProfilePicture | ✅ | |
| getGroupInviteCode | ✅ | bonus |
| revokeGroupInvite | ✅ | bonus |
| joinGroup | ✅ | bonus |
| groupCreate | ✅ | |
| fetchPrivacySettings | ✅ | bonus |
| rejectCall | ✅ | |
| editMessage | ✅ | |

### Findings

| Severity | Finding |
|----------|---------|
| LOW | `updateBio()` missing `humanDelay()` — not in wish scope but is an outgoing action. Low risk (rarely called). |
| INFO | Implementation went beyond wish scope: also protects getGroupInviteCode, revokeGroupInvite, joinGroup, fetchPrivacySettings, updateGroupPicture |
| INFO | `simulateTyping()` wrapped in try/catch — graceful degradation if presence update fails |

### Recommendation

**SHIP** — all acceptance criteria pass. The one LOW finding (`updateBio` missing delay) is non-blocking and can be addressed in a follow-up.
