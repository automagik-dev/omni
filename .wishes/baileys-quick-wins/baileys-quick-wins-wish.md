# WISH: Baileys Quick Wins (B1-B6)

> Six high-value Baileys features: delete messages, check numbers, update bio, block/unblock, disappearing messages, star messages.

**Status:** IN_PROGRESS
**Created:** 2026-02-08
**Author:** Omni + Guga
**Branch:** `feat/baileys-quick-wins`

---

## Context

Gap analysis (docs/BAILEYS-GAP-ANALYSIS.md) identified 22 features Baileys supports that Omni doesn't expose. These 6 are Tier 1 (trivial, <1h each) with the highest impact/effort ratio.

Each task follows the same pattern: Plugin method → API route → CLI command.

---

## Scope

### IN SCOPE

- B1: Delete message for everyone (plugin + API route already exists, needs plugin implementation)
- B2: Check if phone number is on WhatsApp (new plugin method + route + CLI)
- B3: Update own bio/status (new plugin method + route + CLI)
- B4: Block/unblock contacts + fetch blocklist (new plugin methods + routes + CLI)
- B5: Disappearing messages toggle per-chat (new builder + route + CLI)
- B6: Star/unstar messages (new plugin method + routes + CLI)

### OUT OF SCOPE

- Group management (separate wish omni-j5h)
- Community/newsletter features
- Privacy settings
- Profile picture upload
- Business features

---

## Execution Groups

### Group 1: B1 — Delete Message for Everyone
**Files:**
- `packages/channel-whatsapp/src/plugin.ts` — add `deleteMessage()` method
- `packages/cli/src/commands/messages.ts` — add `messages delete` command
**Notes:** API route `POST /messages/delete-channel` already exists. Plugin just needs `deleteMessage(instanceId, channelId, messageId)` method.
**Baileys:** `sock.sendMessage(jid, { delete: { remoteJid: jid, id: messageId, fromMe: true } })`

### Group 2: B2 — Check Number on WhatsApp
**Files:**
- `packages/channel-whatsapp/src/plugin.ts` — add `checkNumber()` method
- `packages/api/src/routes/v2/instances.ts` — add `POST /instances/:id/check-number`
- `packages/cli/src/commands/instances.ts` — add `instances check` command
**Baileys:** `const [result] = await sock.onWhatsApp(phone)` → `{ exists: boolean, jid: string }`

### Group 3: B3 — Update Own Bio
**Files:**
- `packages/channel-whatsapp/src/plugin.ts` — add `updateBio()` method
- `packages/api/src/routes/v2/instances.ts` — add `PUT /instances/:id/profile/status`
- `packages/cli/src/commands/instances.ts` — add `instances update-bio` command
**Baileys:** `await sock.updateProfileStatus(status)`

### Group 4: B4 — Block/Unblock + Blocklist
**Files:**
- `packages/channel-whatsapp/src/plugin.ts` — add `blockContact()`, `unblockContact()`, `fetchBlocklist()`
- `packages/api/src/routes/v2/instances.ts` — add block/unblock/blocklist routes
- `packages/cli/src/commands/instances.ts` — add block/unblock/blocklist commands
**Baileys:** `sock.updateBlockStatus(jid, 'block'|'unblock')`, `sock.fetchBlocklist()`

### Group 5: B5 — Disappearing Messages Toggle
**Files:**
- `packages/channel-whatsapp/src/plugin.ts` — add `setDisappearing()` method
- `packages/api/src/routes/v2/chats.ts` — add `POST /chats/:id/disappearing`
- `packages/cli/src/commands/chats.ts` — add `chats disappearing` command
**Baileys:** `sock.sendMessage(jid, { disappearingMessagesInChat: seconds })` — values: false | 86400 | 604800 | 7776000

### Group 6: B6 — Star/Unstar Messages
**Files:**
- `packages/channel-whatsapp/src/plugin.ts` — add `starMessage()` method
- `packages/api/src/routes/v2/messages.ts` — add `POST /messages/:id/star` and `DELETE /messages/:id/star`
- `packages/cli/src/commands/messages.ts` — add `messages star` / `messages unstar`
**Baileys:** `sock.star(jid, [{ id: messageId, fromMe }], true|false)`

---

## Success Criteria

- [ ] `omni messages delete` works (delete for everyone)
- [ ] `omni instances check <phone>` shows WhatsApp registration status
- [ ] `omni instances update-bio "text"` updates profile status
- [ ] `omni instances block/unblock <jid>` works
- [ ] `omni instances blocklist` shows blocked contacts
- [ ] `omni chats disappearing <id> --duration 24h` toggles disappearing messages
- [ ] `omni messages star/unstar <id>` works
- [ ] `make typecheck` passes
- [ ] `make lint` passes
