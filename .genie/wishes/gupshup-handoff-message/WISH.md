---
slug: gupshup-handoff-message
title: "Gupshup: HANDOFF message type + POST /messages/send/handoff endpoint"
status: SHIPPED
priority: P1
---

## Summary

The Gupshup channel needs a `HANDOFF` message type that posts `msg_type: HANDOFF` to the same Custom Integration callback URL already used for all other outbound types. When triggered via a new `POST /messages/send/handoff` endpoint, the system must also set `agentPaused: true` on the chat — which automatically stops the AI agent from responding and disarms any active follow-up sequence via the existing event chain.

---

## Scope

**IN:**
- `HANDOFF` added to `GupshupOutboundMessage.type` union
- `extra_info?: string` field added to `GupshupOutboundMessage` and appended to payload when present
- New `senders/handoff.ts` in `packages/channel-gupshup/src/senders/`
- `dispatchContent()` routes `content.type === 'handoff'` → `sendHandoff()`
- `extra_info` passed via `OutgoingMessage.metadata.extraInfo` (gupshup-specific, no core changes)
- New `POST /api/v2/messages/send/handoff` route in `packages/api/src/routes/v2/messages.ts`
- OpenAPI/Zod schema for the handoff endpoint, documented with all fields
- Endpoint sets `agentPaused: true` → chains agent stop + follow-up disarm automatically

**OUT:**
- No changes to `CONTENT_TYPES` in `packages/core/src/types/channel.ts`
- No handoff support for other channels (WhatsApp, Telegram, Discord, Slack)
- No new DB migrations
- No changes to the follow-up hooks or disarm logic (already wired via `chat.handoff_activated`)

---

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Channel scope | Gupshup-only | Other channels don't have a handoff API concept today |
| `extra_info` transport | `metadata.extraInfo` | Avoids polluting `OutgoingContent` with gupshup-specific fields |
| Follow-up disarm | via `chats.update({ agentPaused: true })` | Already emits `chat.handoff_activated` → hooks handle disarm |
| Agent stop | `agentPaused: true` in chat settings | Same mechanism as manual pause, consistent behavior |
| `extra_info` absent | Omit from payload entirely | Don't send `extra_info: null` — callers shouldn't need to think about it |

---

## Outbound Payload Shape

```json
{
  "customer_id": "<phone>",
  "user": { "phone": "<phone>" },
  "event_id": "<gupshupEventId>",
  "event_time": "<ISO>",
  "msg_type": "HANDOFF",
  "message_text": "<text sent to end user>",
  "extra_info": "<optional string>"
}
```

`extra_info` is only included when non-empty/non-null.

---

## Endpoint

```
POST /api/v2/messages/send/handoff
```

**Body:**
```typescript
{
  instanceId: string;   // must be a gupshup instance
  chatId: string;       // used to set agentPaused
  to: string;           // phone number (gupshup outbound recipient)
  text: string;         // message shown to end user
  extraInfo?: string;   // optional metadata for handoff
}
```

**Flow:**
1. Validate instance channel type = `'gupshup'` (400 otherwise)
2. `plugin.sendMessage(instanceId, { to, content: { type: 'handoff', text }, metadata: { extraInfo } })`
3. `chats.update(chatId, { settings: { agentPaused: true } })`
   - Emits `chat.handoff_activated` (false→true transition)
   - Follow-up hooks disarm sequence with reason `'handoff'`
   - Agent stops responding

---

## Success Criteria

- [x] `POST /messages/send/handoff` sends payload with `msg_type: 'HANDOFF'`, `message_text`, and `extra_info` (when provided) to Gupshup callback URL
- [x] After request, chat has `agentPaused: true` in DB
- [x] Any active follow-up sequence on the chat is disarmed
- [x] `extraInfo` absent in body → `extra_info` field omitted from payload (not sent as null)
- [x] Channel type != gupshup → 400 with clear error message
- [x] OpenAPI schema documents endpoint with all fields and optionality
- [x] `make typecheck` passes clean
- [x] `make lint` passes clean (no warnings)
- [x] `bun test packages/channel-gupshup` passes

---

## Execution Groups

### Group 1 — Gupshup Plugin: HANDOFF type + sender

**Goal:** Add `HANDOFF` support to the gupshup channel package.

**Deliverables:**
- `packages/channel-gupshup/src/types.ts` — add `'HANDOFF'` to `GupshupOutboundMessage.type`, add `extra_info?: string` field
- `packages/channel-gupshup/src/client.ts` — append `extra_info` to POST payload when present
- `packages/channel-gupshup/src/senders/handoff.ts` — new sender: `sendHandoff(client, to, text, extraInfo?)`
- `packages/channel-gupshup/src/plugin.ts` — import `sendHandoff`, add branch in `dispatchContent` for `content.type === 'handoff'`, read `extraInfo` from `metadata`

**Acceptance criteria:**
- `dispatchContent` with `content.type = 'handoff'` calls `sendHandoff` and passes `extraInfo` from metadata
- Payload sent to Gupshup includes `msg_type: 'HANDOFF'` and `extra_info` only when non-empty
- `make typecheck` passes clean on `packages/channel-gupshup`

**Validation:**
```bash
cd packages/channel-gupshup && bunx tsc --noEmit
bun test packages/channel-gupshup
```

---

### Group 2 — API: endpoint + OpenAPI schema

**Goal:** Expose `POST /messages/send/handoff` with full schema documentation.

**Deliverables:**
- `packages/api/src/routes/v2/messages.ts` — new route `POST /messages/send/handoff` following the pattern of `send/location`; validates channel = gupshup, calls plugin.sendMessage, calls chats.update
- OpenAPI schema block for the endpoint (inline Zod schema + `.openapi()` annotations), documented with all fields including `extraInfo` as optional

**Acceptance criteria:**
- `POST /messages/send/handoff` on a gupshup instance calls plugin + sets agentPaused
- Non-gupshup instance returns 400 with message `"Handoff is only supported on Gupshup instances"`
- Route is listed in OpenAPI spec output
- `make typecheck` and `make lint` pass clean

**Validation:**
```bash
make typecheck
make lint
```

---

## Dependencies

- `depends-on: gupshup-channel-rewrite` — Group 1 builds on the rewritten plugin structure (senders pattern, client, types)

---

## Assumptions / Risks

- Gupshup accepts `msg_type: HANDOFF` on the same Custom Integration callback URL — unconfirmed at API level, but user confirmed it's the same pipeline
- `extra_info` field name must match exactly what Gupshup expects downstream — verify with Gupshup docs/integration owner before shipping
- `agentPaused: true` stops ALL agent responses for the chat, not just follow-ups — this is intentional but irreversible without a manual unpause
