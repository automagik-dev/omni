---
slug: fix-whatsapp-edit-long-messages
title: "Fix WhatsApp message edit silently failing on long messages"
status: ready
github_issue: 224
priority: P2
---

## Problem

`omni messages edit` returns success but the message on WhatsApp is NOT updated. The original text remains visible to all group participants. This affects long messages (~1500 chars) in group chats on WhatsApp Business.

Two usage patterns both fail:
- **External ID** fails with "Cannot resolve message ID prefix without chat context" (CLI resolver treats hex external IDs as UUID prefixes)
- **Internal UUID** returns success but doesn't apply the edit (Baileys silently ignores the edit because the message key is wrong)

The issue is silent -- no error is thrown, the API returns `{ edited: true }`, but the edit never reaches WhatsApp.

## Root Cause Analysis

Code analysis reveals **two distinct bugs** in the edit pipeline:

### Bug 1: Message ID not resolved from internal UUID to external ID

The `edit-channel` API endpoint (`packages/api/src/routes/v2/messages.ts:2146`) passes the `messageId` field directly through to `plugin.editMessage()` without resolving it. The CLI's `resolveMessageId()` returns an Omni internal UUID (e.g., `a1b2c3d4-...`), but `editMessage()` needs the WhatsApp external message ID (e.g., `3EB0A1B2C3D4E5F6`).

Baileys constructs a `protocolMessage.key` from the edit key (`lib/Utils/messages.js:500-508`). When the `id` field contains an Omni UUID instead of the WhatsApp message ID, WhatsApp cannot match it to any existing message, so the edit is silently dropped.

The same bug exists in `delete-channel` but is out of scope for this wish.

### Bug 2: Missing `participant` field in edit key for group chats

The `editMessage()` method (`packages/channel-whatsapp/src/plugin.ts:3934`) constructs the edit key as:
```ts
{ remoteJid: jid, id: messageId, fromMe }
```

But WhatsApp's `IMessageKey` protobuf (`WAProto/index.d.ts:9567`) also requires a `participant` field for group messages:
```ts
interface IMessageKey {
  remoteJid?: string | null;
  fromMe?: boolean | null;
  id?: string | null;
  participant?: string | null;  // Required for group chats
}
```

In group chats, `participant` identifies which group member sent the message. Without it, WhatsApp cannot locate the message in the group context, and the edit is silently ignored. The stream sender (`stream.ts:298-305`) has the same missing-participant issue but works because it edits messages immediately after sending them (within the same session), so Baileys can still locate them.

### Why long messages surface the bug

The bug affects all message lengths, but long messages are the most common use case for edits (e.g., editing a bot's streamed response after it completes). Short messages are rarely edited via CLI.

## Execution Groups

### Group 0: Investigation — confirm root cause hypotheses

**Files:**
- `packages/channel-whatsapp/src/plugin.ts` (editMessage method)
- `packages/api/src/routes/v2/messages.ts` (edit-channel endpoint)

**Changes:**
- Add temporary debug logging to `editMessage()` to log the `messageId` it receives and the message's `externalId` from the DB
- Test an edit in a DM chat (1:1) to confirm participant hypothesis — if DM edits work but group edits don't, hypothesis confirmed
- Check if Baileys returns an error or silently drops the edit (add `.catch()` or inspect return value of `sock.sendMessage()`)
- Verify no message length limit in Baileys for edits (WhatsApp text limit is 65536 chars)

**Acceptance Criteria for investigation:**
- [ ] Confirmed: messageId passed to editMessage is internal UUID vs external ID
- [ ] Confirmed: group edits fail without participant field, DM edits may work
- [ ] Confirmed: Baileys behavior on failed edit (silent drop vs error)
- [ ] Confirmed: no Baileys-specific length limit for edits

**Tests:** Manual verification with debug logging; remove debug logging after investigation.

## Acceptance Criteria

- [ ] `omni messages edit <uuid> --instance <id> --chat <jid> --text "new text"` successfully edits the message on WhatsApp (visible to all participants)
- [ ] Edits work in group chats (@g.us JIDs)
- [ ] Edits work in DM chats (@s.whatsapp.net JIDs)
- [ ] Edits work with messages of any length (up to WhatsApp's 65536 char limit)
- [ ] The API returns an error (not silent success) when the edit cannot be applied
- [ ] External message IDs can be used directly with `--chat` context
- [ ] Unit tests cover the edit flow for both DM and group contexts
- [ ] The `edit-channel` endpoint resolves internal UUID to external ID before calling the plugin

## Execution Groups

### Group 1: API endpoint — resolve messageId to externalId

**Files:**
- `packages/api/src/routes/v2/messages.ts` (lines 2146-2202)

**Changes:**
- In the `edit-channel` route handler, look up the message by `messageId` (internal UUID) from the database
- Extract the `externalId` and `chatId` from the message record
- Pass the `externalId` (not the internal UUID) to `plugin.editMessage()`
- If the `messageId` is already a non-UUID string (looks like a WhatsApp external ID), pass it through directly
- Return a proper error if the message is not found in the database

**Tests:**
- Unit test: verify the endpoint resolves UUID to external ID before calling editMessage
- Unit test: verify non-UUID messageIds are passed through unchanged
- Unit test: verify 404 when message UUID doesn't exist

### Group 2: WhatsApp plugin — add `participant` to edit key for groups

**Files:**
- `packages/channel-whatsapp/src/plugin.ts` (lines 3924-3939)

**Changes:**
- Modify `editMessage()` to accept an optional `participant` parameter (the sender's JID)
- When the chat is a group (`@g.us`), include the `participant` field in the edit key
- For `fromMe` edits in groups, resolve the bot's own JID from `sock.user?.id` and use it as `participant`
- Remove the `as unknown` cast on the edit key — use the proper `proto.IMessageKey` type

```ts
async editMessage(
  instanceId: string,
  chatJid: string,
  messageId: string,
  newText: string,
  fromMe = true,
): Promise<void> {
  await this.humanDelay(instanceId);
  const sock = this.getSocket(instanceId);
  const jid = toJid(chatJid);

  const editKey: proto.IMessageKey = {
    remoteJid: jid,
    id: messageId,
    fromMe,
  };

  // Group chats require participant to identify the sender
  if (isGroupJid(jid) && fromMe) {
    editKey.participant = sock.user?.id;
  }

  await sock.sendMessage(jid, { edit: editKey, text: newText });
  this.logger.info('Message edited', { instanceId, chatJid: jid, messageId, fromMe });
}
```

**Tests:**
- Unit test: `editMessage` in group chat includes `participant` in key
- Unit test: `editMessage` in DM chat does NOT include `participant`
- Unit test: `editMessage` uses the bot's own JID as participant when `fromMe=true`

### Group 3: CLI — support external ID with chat context

**Files:**
- `packages/cli/src/commands/messages.ts` (lines 478-511)
- `packages/cli/src/resolve.ts` (lines 135-164)

**Changes:**
- In the CLI `edit` command, pass `--chat` through to `resolveMessageId` so it can resolve UUID prefixes
- Allow `resolveMessageId` to pass through non-UUID strings (WhatsApp external IDs look like hex strings without hyphens) when chat context is available
- The CLI already calls `resolveMessageId(messageId)` without chat context (line 487) — add the chat ID for prefix resolution

**Tests:**
- Unit test: external ID (hex string without hyphens) passes through resolveMessageId
- Unit test: UUID prefix resolves correctly when chat context is provided

### Group 4: Stream sender — add participant to edit key (consistency)

**Files:**
- `packages/channel-whatsapp/src/senders/stream.ts` (lines 297-306, 319-331)

**Changes:**
- In `doEdit()` and `doEditRaw()`, add `participant` to the edit key for group chats (same fix as Group 2)
- The stream sender currently works because Baileys can find recent messages without participant, but this is fragile and should be fixed for correctness

**Tests:**
- Update existing stream sender tests to verify participant is included in group edit keys

### Group 5: Error propagation — surface Baileys edit failures

**Files:**
- `packages/channel-whatsapp/src/plugin.ts` (editMessage method)
- `packages/api/src/routes/v2/messages.ts` (edit-channel endpoint)

**Changes:**
- In `editMessage()`, capture and log the return value of `sock.sendMessage()` for the edit
- If Baileys throws, re-throw as a `WhatsAppError` with a clear message
- In the API endpoint, catch plugin errors and return proper HTTP error responses instead of always returning `{ edited: true }`

**Tests:**
- Unit test: Baileys error propagates as HTTP 500
- Unit test: successful edit returns 200 with message details

## Dependencies

- **Group 1 must be done before Group 3** — the CLI fix depends on the API properly handling both UUID and external ID formats
- **Group 2 is independent** — can be done in parallel with Group 1
- **Group 4 depends on Group 2** — same pattern, apply to stream sender after plugin is fixed
- **Group 5 depends on Groups 1 and 2** — error propagation is best added after the core fixes are in

## Risks

1. **Participant JID format**: The bot's `sock.user?.id` might be a LID JID (`@lid`) on newer WhatsApp Business accounts. Need to test whether the participant field accepts LID JIDs or requires phone-number JIDs (`@s.whatsapp.net`). The plugin already has LID-to-phone mapping caches that could be used.

2. **Edit window limitation**: WhatsApp has a server-side time limit for editing messages (approximately 15 minutes from the official client, though the exact enforcement via Baileys is unclear). Edits outside this window will fail silently even with the correct key. Consider documenting or warning about this limitation.

3. **Non-text message edits**: The current `editMessage` only supports text. If the original message was an image/video with a caption, editing the caption may require a different message format (e.g., `imageMessage` with new caption instead of `text`). Out of scope for this wish but worth noting.

4. **Regression in stream sender**: Changing the stream sender's edit key construction (Group 4) could break working streaming if the participant resolution fails. The stream sender should fall back to the current behavior (no participant) if `sock.user?.id` is unavailable.

5. **Database lookup performance**: Group 1 adds a database lookup to the edit-channel endpoint. This is a single-row query by primary key and should be fast, but worth monitoring.

## Validation

```bash
# Group 0 — investigation (manual, requires WhatsApp instance)
# Add debug logging, test edit in DM vs group, observe Baileys behavior

# Groups 1-2 — core fixes
bun test packages/api/src/routes/__tests__/messages.test.ts
bun test packages/channel-whatsapp/src/__tests__/plugin.test.ts

# Group 4 — stream sender consistency
bun test packages/channel-whatsapp/src/senders/__tests__/stream.test.ts

# Full suite — verify no regressions
make test
make check
```
