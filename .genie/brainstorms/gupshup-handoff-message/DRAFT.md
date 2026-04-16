# Brainstorm Draft — Gupshup Handoff Message Type

**Date:** 2026-04-14
**Status:** Raw

## Problem Statement

We need a `handoff` message type for the Gupshup channel that:
1. Sends some form of outbound message (or notification) indicating the chat is being handed off
2. Automatically stops any active follow-up sequence for that chat
3. Carries an optional `extra_info: string` field

## What We Know

### Existing Infrastructure
- `chat.handoff_activated` event already exists in `packages/core/src/events/types.ts`
- Follow-up hooks already listen to `chat.handoff_activated` → disarm with reason `'handoff'`
- `GupshupOutboundMessage.type` currently supports: TEXT, IMAGE, AUDIO, VIDEO, DOCUMENT, STICKER, LOCATION
- `ContentType` in core does NOT include `handoff` — would need to be added, OR handled as gupshup-specific metadata
- `dispatchContent()` in plugin.ts routes message types to senders

### Confirmed
- Same `callbackUrl` (configured per channel instance in `GupshupConfig`)
- Same POST endpoint, just `msg_type: 'HANDOFF'` in the payload
- `extra_info` would go as a field in that same JSON payload

### Also Confirmed
- New API endpoint needed: `POST /messages/send/handoff`
- Follows same pattern as `send/text`, `send/location` in `packages/api/src/routes/v2/messages.ts`
- `extra_info` comes in the request body, flows into the plugin

### Also Confirmed
- `msg_type: 'HANDOFF'` = same pipeline, same callback URL
- Gupshup uses it to: (1) send message to end user, (2) trigger handoff to human agent, (3) populate fields in another API
- Payload = SAME base fields as other types + `extra_info?: string`
- `message_text` is still required (message shown to end user)

## Design Decision: GUPSHUP-ONLY (no core changes)
- Do NOT add `'handoff'` to `CONTENT_TYPES` in core
- Pass `extra_info` via `OutgoingMessage.metadata.extraInfo` (gupshup-specific)
- Endpoint validates channel type = gupshup, returns error otherwise
- `GupshupOutboundMessage.type` gets `| 'HANDOFF'` + `extra_info?: string`
- `client.send()` appends `extra_info` to payload when present
- New `senders/handoff.ts`: calls `client.send(to, { type: 'HANDOFF', text, extra_info })`
- After send: call `chats.update(chatId, { settings: { agentPaused: true } })`
  - This already emits `chat.handoff_activated` (false→true transition in chats.ts:591)
  - Which already disarms follow-up via follow-up-hooks.ts:118
  - Which already stops the agent from responding
  - No need to emit the event manually — the chain is already wired

## Endpoint Flow
1. Validate channel = gupshup
2. `plugin.sendMessage(instanceId, { to, content: { type: 'handoff', text }, metadata: { extraInfo } })`
3. `chats.update(chatId, { settings: { agentPaused: true } })` → chains everything

## extra_info Field
- Optional string
- Purpose: TBD — free-form metadata about why/how the handoff happened

## Follow-up Disarm
- Already handled by `chat.handoff_activated` event
- Emitting that event from the plugin's `sendMessage` on handoff type will cover it
