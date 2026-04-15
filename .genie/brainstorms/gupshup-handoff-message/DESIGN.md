# Design — Gupshup Handoff Message Type

**Date:** 2026-04-14
**Status:** Ready for /wish

## Problem

The Gupshup channel needs a `handoff` message type that:
1. Sends `msg_type: HANDOFF` to the Gupshup callback URL (same pipeline)
2. Stops the AI agent from responding (`agentPaused: true`)
3. Disarms any active follow-up sequence for the chat
4. Carries an optional `extra_info: string` field in the payload

## Scope

**IN:**
- New `POST /messages/send/handoff` API endpoint (gupshup-only)
- OpenAPI/Zod schema for the endpoint with `instanceId`, `chatId`, `to`, `text`, `extraInfo?`
- `HANDOFF` added to `GupshupOutboundMessage.type` union
- `extra_info?: string` added to `GupshupOutboundMessage`
- `client.send()` appends `extra_info` to payload when present
- New `senders/handoff.ts` in `packages/channel-gupshup/src/senders/`
- `dispatchContent()` routes `content.type === 'handoff'` → `sendHandoff`
- Endpoint sets `agentPaused: true` → chains agent stop + follow-up disarm automatically

**OUT:**
- No changes to `CONTENT_TYPES` in `packages/core/src/types/channel.ts`
- No handoff support for other channels (WhatsApp, Telegram, Discord, Slack)
- No new DB migrations needed

## Architecture

### Payload (same base + extra)
```json
{
  "customer_id": "<phone>",
  "user": { "phone": "<phone>" },
  "event_id": "<gupshupEventId>",
  "event_time": "<iso>",
  "msg_type": "HANDOFF",
  "message_text": "<text>",
  "extra_info": "<optional string>"
}
```

### Endpoint Flow
```
POST /api/v2/messages/send/handoff
  body: { instanceId, chatId, to, text, extraInfo? }

1. Validate channel type = 'gupshup' (400 otherwise)
2. plugin.sendMessage(instanceId, {
     to,
     content: { type: 'handoff', text },
     metadata: { extraInfo }
   })
   → GupshupPlugin.dispatchContent → sendHandoff()
   → GupshupClient.send({ type: 'HANDOFF', text, extra_info })
3. chats.update(chatId, { settings: { agentPaused: true } })
   → emits chat.handoff_activated (false→true transition)
   → follow-up-hooks: disarmSequence(reason: 'handoff')
   → agent stops responding
```

### Files to Create/Modify

| File | Change |
|------|--------|
| `packages/channel-gupshup/src/types.ts` | Add `'HANDOFF'` to `GupshupOutboundMessage.type`, add `extra_info?: string` |
| `packages/channel-gupshup/src/client.ts` | Append `extra_info` to payload when present |
| `packages/channel-gupshup/src/senders/handoff.ts` | New sender |
| `packages/channel-gupshup/src/plugin.ts` | Import + route `handoff` in `dispatchContent` |
| `packages/api/src/routes/v2/messages.ts` | New `POST /messages/send/handoff` route |
| `packages/api/src/schemas/openapi/messages.ts` (or equivalent) | OpenAPI schema for handoff endpoint |

## Acceptance Criteria

1. `POST /messages/send/handoff` sends correct payload to Gupshup with `msg_type: 'HANDOFF'`, `message_text`, and `extra_info` (when provided)
2. After the request, the chat has `agentPaused: true` in the DB
3. Any active follow-up sequence on the chat is disarmed
4. Calling the endpoint on a non-gupshup channel returns a clear error (400/422)
5. `extra_info` absent in body → field omitted from payload (not sent as `null`)
6. OpenAPI schema documents the endpoint with all fields and their optionality
