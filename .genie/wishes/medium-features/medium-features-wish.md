# WISH: Medium Effort Features (C1-C7)

> Seven medium-effort features: chat modifications, profile picture, group invites, privacy settings, call rejection, message editing.

**Status:** IN_PROGRESS
**Beads:** omni-1s0
**Created:** 2026-02-08
**Author:** Omni + Guga
**Branch:** `feat/medium-features`

---

## Context

Tier 2 features from the Baileys gap analysis. Each requires plugin method + API route + CLI command.
C4 (blocklist) may be done by Group 2 (B4) — skip if already implemented.

---

## Scope

### IN SCOPE
- C1: Archive/pin/mute chats via chatModify
- C2: Update/remove profile picture
- C3: Group invite links (get/revoke/join)
- C4: Fetch blocklist (skip if B4 covers it)
- C5: Privacy settings (read-only)
- C6: Reject incoming calls
- C7: Edit message (fix canEditMessage + send path)

### OUT OF SCOPE
- Privacy settings write (separate wish)
- Group creation/management (omni-j5h)
- Newsletter/community features
- Business catalog features

---

## Execution Groups

### C1: Archive/Pin/Mute Chats
**Plugin:** `chatModify()` wrapper — `sock.chatModify({ archive|pin|mute }, jid)`
**API:** POST /chats/:id/archive, /chats/:id/pin, /chats/:id/mute (each with instanceId + toggle body)
**CLI:** chats archive/unarchive/pin/unpin/mute/unmute
**Note:** chatModify needs lastMessages array for archive — get from chat history

### C2: Update Profile Picture
**Plugin:** `updateProfilePicture()` and `removeProfilePicture()` calling sock methods
**API:** PUT /instances/:id/profile/picture (accept base64 or URL), DELETE /instances/:id/profile/picture
**CLI:** instances update-picture <id> --file <path> or --url <url>, instances remove-picture <id>

### C3: Group Invite Links
**Plugin:** `groupInviteCode()`, `groupRevokeInvite()`, `groupAcceptInvite()` wrapping sock methods
**API:** GET /instances/:id/groups/:groupId/invite, POST /instances/:id/groups/:groupId/invite/revoke, POST /instances/:id/groups/join
**CLI:** instances group-invite/group-revoke-invite/group-join

### C4: Blocklist (if not in B4)
Skip if B4 already implements GET /instances/:id/blocklist

### C5: Privacy Settings (Read)
**Plugin:** `fetchPrivacySettings()` calling `sock.fetchPrivacySettings(true)`
**API:** GET /instances/:id/privacy
**CLI:** instances privacy <id>

### C6: Reject Incoming Calls
**Plugin:** `rejectCall()` calling `sock.rejectCall(callId, callFrom)`
**API:** POST /instances/:id/calls/reject with { callId, callFrom }
**CLI:** instances reject-call <id> --call-id <id> --from <jid>
**Note:** Call events already logged in all-events.ts handler

### C7: Edit Message
**Plugin:** `editMessage()` using sock.sendMessage with edit protocol
**API:** Use existing PUT /messages/:id or add POST /messages/:id/edit-channel
**CLI:** messages edit <id> --text "new text" --instance <id>
**Fix:** Set canEditMessage: true in capabilities.ts
**Baileys:** `sock.sendMessage(jid, { edit: key, text: newText })`

---

## Success Criteria
- [ ] chats archive/unarchive/pin/unpin/mute/unmute work
- [ ] instances update-picture and remove-picture work
- [ ] Group invite link get/revoke/join work
- [ ] instances privacy shows privacy settings
- [ ] instances reject-call rejects incoming call
- [ ] messages edit updates message text
- [ ] canEditMessage set to true
- [ ] make typecheck passes
- [ ] make lint passes
