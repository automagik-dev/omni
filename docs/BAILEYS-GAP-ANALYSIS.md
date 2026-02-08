# Baileys Gap Analysis — Omni WhatsApp Implementation

> Generated: 2026-02-08
> Source: Deep analysis of `packages/channel-whatsapp/`, `packages/api/`, `packages/cli/`, and [baileys.wiki](https://baileys.wiki/docs/api/)

## Table of Contents

1. [What Omni Already Implements](#1-what-omni-already-implements)
2. [What Baileys Supports but Omni Doesn't Expose](#2-what-baileys-supports-but-omni-doesnt-expose)
3. [CLI vs API Coverage](#3-cli-vs-api-coverage)
4. [Quick Wins — Low Effort, High Value](#4-quick-wins--low-effort-high-value)
5. [Feature Gap Details — Ordered by Effort](#5-feature-gap-details--ordered-by-effort)

---

## 1. What Omni Already Implements

### ✅ Core Messaging (Sending)
| Feature | Plugin | API Route | CLI | Notes |
|---------|--------|-----------|-----|-------|
| Send text | ✅ `builders.ts` | ✅ `POST /messages/send` | ✅ `--text` | With mentions support |
| Send image | ✅ `builders.ts` | ✅ `POST /messages/send/media` | ✅ `--media` | URL + base64 |
| Send video | ✅ `builders.ts` | ✅ `POST /messages/send/media` | ✅ `--media` | URL + base64 |
| Send audio | ✅ `builders.ts` | ✅ `POST /messages/send/media` | ✅ `--media` | URL + base64 |
| Send document | ✅ `builders.ts` | ✅ `POST /messages/send/media` | ✅ `--media` | With filename |
| Send voice note (PTT) | ✅ `builders.ts` | ✅ via `voiceNote` flag | ✅ `--voice` | OGG/Opus conversion |
| Send sticker | ✅ `builders.ts` | ✅ `POST /messages/send/sticker` | ✅ `--sticker` | URL + base64 |
| Send reaction | ✅ `builders.ts` | ✅ `POST /messages/send/reaction` | ✅ `--reaction` | With target message |
| Send contact card | ✅ `contact.ts` | ✅ `POST /messages/send/contact` | ✅ `--contact` | vCard format |
| Send location | ✅ `location.ts` | ✅ `POST /messages/send/location` | ✅ `--location` | With name/address |
| Send poll | ✅ `builders.ts` | ✅ `POST /messages/send/poll` (Discord only) | ✅ `--poll` | **Note:** API route labeled Discord but plugin builds for WA |
| Forward message | ✅ `builders.ts` | ✅ `POST /messages/send/forward` | ❌ | Uses rawPayload |
| Reply to message | ✅ `plugin.ts` | ✅ via `replyTo` param | ✅ `--reply-to` | With quoted context |
| Send TTS voice note | ✅ via audio | ✅ `POST /messages/send/tts` | ❌ | ElevenLabs integration |
| Mentions (@user) | ✅ `builders.ts` | ✅ via `mentions` param | ❌ | JID-based mentions |

### ✅ Core Messaging (Receiving)
| Feature | Plugin | Notes |
|---------|--------|-------|
| Receive text | ✅ | conversation + extendedTextMessage |
| Receive image | ✅ | With auto-download to disk |
| Receive video | ✅ | With auto-download |
| Receive audio | ✅ | With auto-download |
| Receive document | ✅ | With filename, auto-download |
| Receive sticker | ✅ | With auto-download |
| Receive location | ✅ | Lat/lng/name/address |
| Receive live location | ✅ | Caption-based |
| Receive contact | ✅ | vCard parsing |
| Receive reaction | ✅ | Via messages.upsert + messages.reaction |
| Receive poll creation | ✅ | pollCreationMessage + v3 |
| Receive poll vote | ✅ | pollUpdateMessage (note: votes encrypted) |
| Receive event/calendar | ✅ | eventMessage |
| Receive product | ✅ | productMessage |
| Receive message edit | ✅ | protocolMessage type 14 + messages.update |
| Receive message delete | ✅ | protocolMessage type 0 + messages.delete |
| Template button reply | ✅ | Mapped to text |
| List response | ✅ | Mapped to text |
| Buttons response | ✅ | Mapped to text |
| Device sent message | ✅ | Unwraps inner message |

### ✅ Presence & Typing
| Feature | Plugin | API Route | CLI | Notes |
|---------|--------|-----------|-----|-------|
| Send typing indicator | ✅ `typing.ts` | ✅ `POST /messages/send/presence` | ✅ `--presence typing` | Auto-pause |
| Send recording indicator | ✅ `typing.ts` | ✅ `POST /messages/send/presence` | ✅ `--presence recording` | Auto-pause |
| Stop typing | ✅ `typing.ts` | ✅ `POST /messages/send/presence` | ✅ `--presence paused` | |
| Update online/offline | ✅ `presence.ts` | ❌ | ❌ | Plugin method exists, no API route |
| Subscribe to presence | ✅ `presence.ts` | ❌ | ❌ | Method exists, not exposed |
| Receive presence updates | ✅ `all-events.ts` | ❌ | ❌ | Logged but not emitted to API |

### ✅ Read Receipts
| Feature | Plugin | API Route | CLI | Notes |
|---------|--------|-----------|-----|-------|
| Mark message as read | ✅ `receipts.ts` | ✅ `POST /messages/:id/read` | ✅ `messages read` | |
| Mark batch as read | ✅ `receipts.ts` | ✅ `POST /messages/read` | ✅ `messages read --batch` | |
| Mark chat as read | ✅ `plugin.ts` | ✅ `POST /chats/:id/read` | ✅ `chats read` | |
| Receive delivery receipt | ✅ `messages.ts` | ✅ | ❌ | Via messages.update status |
| Receive read receipt | ✅ `messages.ts` | ✅ | ❌ | Via messages.update status |

### ✅ Connection & Auth
| Feature | Plugin | API Route | CLI | Notes |
|---------|--------|-----------|-----|-------|
| QR code auth | ✅ | ✅ `GET /instances/:id/qr` | ✅ `instances qr` | With watch mode |
| Pairing code auth | ✅ | ✅ `POST /instances/:id/pair` | ✅ `instances pair` | Phone number |
| Connect/disconnect | ✅ | ✅ `/instances/:id/connect` | ✅ `instances connect` | |
| Reconnect with backoff | ✅ | Automatic | ❌ | Built into connection handler |
| Logout (clear auth) | ✅ | ✅ `POST /instances/:id/logout` | ✅ `instances logout` | |
| Restart | ✅ | ✅ `POST /instances/:id/restart` | ✅ `instances restart` | |

### ✅ Sync & History
| Feature | Plugin | API Route | CLI | Notes |
|---------|--------|-----------|-----|-------|
| History sync (passive) | ✅ | ✅ via sync jobs | ✅ `instances sync` | On connect |
| Active message fetch | ✅ | ✅ via sync jobs | ✅ `instances sync --type messages` | With anchors |
| Contact sync | ✅ | ✅ `GET /instances/:id/contacts` | ✅ `instances contacts` | Cached |
| Group sync | ✅ | ✅ `GET /instances/:id/groups` | ✅ `instances groups` | groupFetchAllParticipating |
| Profile sync | ✅ | ✅ `POST /instances/:id/sync/profile` | ✅ `instances sync --type profile` | |
| User profile fetch | ✅ | ✅ `GET /instances/:id/users/:id/profile` | ✅ `instances profile` | Avatar + bio + business |

### ✅ Events Handled (but mostly just logged)
| Baileys Event | Handled | Emitted to API | Notes |
|---------------|---------|----------------|-------|
| `connection.update` | ✅ | ✅ | QR, connect, disconnect |
| `creds.update` | ✅ | ✅ | Auth state persistence |
| `messages.upsert` | ✅ | ✅ | Full message processing |
| `messages.update` | ✅ | ✅ | Status + edit updates |
| `messages.delete` | ✅ | ✅ | Deletion handling |
| `messages.reaction` | ✅ | ✅ | Reaction updates |
| `messages.media-update` | ✅ | ❌ | Logged only (TODO) |
| `messaging-history.set` | ✅ | ✅ | History processing |
| `chats.upsert` | ✅ | Cached | Display name cache |
| `chats.update` | ✅ | Cached | Display name updates |
| `chats.delete` | ✅ | ❌ | TODO |
| `contacts.upsert` | ✅ | Cached | Contact cache |
| `contacts.update` | ✅ | Cached | Contact updates |
| `groups.upsert` | ✅ | Cached | Group metadata cache |
| `groups.update` | ✅ | Cached | Group updates |
| `group-participants.update` | ✅ | ❌ | TODO |
| `group.join-request` | ✅ | ❌ | TODO |
| `presence.update` | ✅ | ❌ | Logged only |
| `call` | ✅ | ❌ | Logged only |
| `blocklist.set` | ✅ | ❌ | TODO |
| `blocklist.update` | ✅ | ❌ | TODO |
| `labels.edit` | ✅ | ❌ | TODO |
| `labels.association` | ✅ | ❌ | TODO |
| `newsletter.*` | ✅ | ❌ | Logged only (4 events) |
| `lid-mapping.update` | ✅ | ❌ | Logged only |

---

## 2. What Baileys Supports but Omni Doesn't Expose

### 🔴 Not Implemented at All

#### Group Management (Active Operations)
Baileys has full group management API but Omni only reads groups — no write operations:
- `groupCreate(subject, participants)` — Create a new group
- `groupLeave(id)` — Leave a group
- `groupParticipantsUpdate(jid, participants, action)` — Add/remove/promote/demote members
- `groupSettingUpdate(jid, setting)` — Toggle announcement/locked mode
- `groupToggleEphemeral(jid, expiration)` — Set disappearing messages
- `groupUpdateSubject(jid, subject)` — Change group name
- `groupUpdateDescription(jid, description)` — Change group description
- `groupInviteCode(jid)` — Get group invite link
- `groupRevokeInvite(jid)` — Revoke invite link
- `groupAcceptInvite(code)` — Join group via code
- `groupJoinApprovalMode(jid, mode)` — Toggle join approval
- `groupMemberAddMode(jid, mode)` — Who can add members
- `groupRequestParticipantsList(jid)` — List pending join requests
- `groupRequestParticipantsUpdate(jid, participants, action)` — Approve/reject join requests

#### Community Management (Entire Feature)
Baileys has ~20 community methods, Omni has zero:
- `communityCreate`, `communityLeave`, `communityMetadata`
- `communityCreateGroup`, `communityLinkGroup`, `communityUnlinkGroup`
- `communityFetchAllParticipating`, `communityFetchLinkedGroups`
- `communityParticipantsUpdate`, `communitySettingUpdate`
- `communityInviteCode`, `communityRevokeInvite`, `communityAcceptInvite`
- Full participant management (approval mode, member add mode, requests)

#### Newsletter/Channel Management (Entire Feature)
Baileys has ~20 newsletter methods, Omni has zero:
- `newsletterCreate`, `newsletterDelete`
- `newsletterMetadata`, `newsletterFollow`, `newsletterUnfollow`
- `newsletterMute`, `newsletterUnmute`
- `newsletterUpdate`, `newsletterUpdateName/Description/Picture`
- `newsletterChangeOwner`, `newsletterDemote`
- `newsletterAdminCount`, `newsletterSubscribers`
- `newsletterFetchMessages`, `newsletterReactMessage`
- `subscribeNewsletterUpdates`

#### Privacy Settings (Entire Feature)
- `fetchPrivacySettings(force)` — Get all privacy settings
- `updateLastSeenPrivacy(value)` — Who can see last seen
- `updateOnlinePrivacy(value)` — Who can see online status
- `updateProfilePicturePrivacy(value)` — Who can see profile pic
- `updateStatusPrivacy(value)` — Who can see status
- `updateReadReceiptsPrivacy(value)` — Toggle read receipts
- `updateGroupsAddPrivacy(value)` — Who can add to groups
- `updateDefaultDisappearingMode(duration)` — Default disappearing timer
- `updateCallPrivacy(value)` — Who can call
- `updateMessagesPrivacy(value)` — Messages privacy

#### Business Features
- `getCatalog(options)` — Get product catalog
- `getCollections(jid?, limit)` — Get catalog collections
- `productCreate(create)` — Create product
- `productUpdate(productId, update)` — Update product
- `productDelete(productIds)` — Delete products
- `getOrderDetails(orderId, tokenBase64)` — Get order details
- `updateBussinesProfile(args)` — Update business profile

#### Chat Modifications (via `chatModify`)
- Archive/unarchive chats — `{ archive: boolean, lastMessages }`
- Pin/unpin chats — `{ pin: boolean }`
- Mute/unmute chats — `{ mute: number | null }`
- Clear chat history — `{ clear: boolean, lastMessages }`
- Delete for me — `{ deleteForMe: { key, timestamp, deleteMedia } }`
- Star/unstar messages — `{ star: { messages, star } }`
- Mark unread — `{ markRead: false, lastMessages }`

#### Call Features
- `createCallLink(type, event?, timeoutMs?)` — Create call link (audio/video)
- `rejectCall(callId, callFrom)` — Reject incoming call
- Call event processing (logged but not actionable)

#### Message Operations
- `sendMessage` with `{ delete: key }` — Delete for everyone
- `sendMessage` with `{ disappearingMessagesInChat: boolean | number }` — Toggle disappearing
- Star messages via `chatModify` or `star(jid, messages, star)`

#### Contact Management
- `onWhatsApp(...phoneNumber)` — Check if numbers are on WhatsApp
- `addOrEditContact(jid, contact)` — Add/edit contact in address book
- `removeContact(jid)` — Remove contact

#### Profile Management (Own)
- `updateProfilePicture(jid, content)` — Update own profile pic
- `removeProfilePicture(jid)` — Remove own profile pic
- `updateProfileStatus(status)` — Update own bio/status
- `updateProfileName(name)` — Update own display name
- `updateCoverPhoto(photo)` — Update cover photo
- `removeCoverPhoto(id)` — Remove cover photo

#### Block Management
- `fetchBlocklist()` — Get blocked contacts list
- `updateBlockStatus(jid, action)` — Block/unblock contact

#### Label Management (Business)
- `addChatLabel(jid, labelId)` / `removeChatLabel(jid, labelId)`
- `addMessageLabel(jid, messageId, labelId)` / `removeMessageLabel(jid, messageId, labelId)`
- `addLabel(jid, labels)` / `addOrEditQuickReply(quickReply)` / `removeQuickReply(timestamp)`

#### Disappearing Messages
- `fetchDisappearingDuration(...jids)` — Check disappearing settings
- Per-chat toggle via `sendMessage` with `disappearingMessagesInChat`
- Group-wide toggle via `groupToggleEphemeral`

---

## 3. CLI vs API Coverage

### API Endpoints with NO CLI Equivalent

| API Route | Description | CLI Gap |
|-----------|-------------|---------|
| `POST /messages/send/tts` | Send TTS voice note | ❌ No `--tts` flag |
| `POST /messages/send/forward` | Forward message | ❌ No `--forward` flag |
| `POST /messages/send/presence` | Send presence | ✅ Actually has `--presence` |
| `POST /messages/send/poll` | Send poll | ✅ Has `--poll` |
| `POST /messages/send/embed` | Send embed (Discord) | ✅ Has `--embed` |
| `PATCH /messages/:id/transcription` | Update transcription | ❌ No CLI |
| `PATCH /messages/:id/image-description` | Update image description | ❌ No CLI |
| `PATCH /messages/:id/video-description` | Update video description | ❌ No CLI |
| `PATCH /messages/:id/document-extraction` | Update doc extraction | ❌ No CLI |
| `PATCH /messages/:id/delivery-status` | Update delivery status | ❌ No CLI |
| `POST /messages/:id/edit` | Record message edit | ❌ No CLI |
| `POST /messages/:id/reactions` | Add reaction (DB) | ❌ No CLI |
| `DELETE /messages/:id/reactions` | Remove reaction (DB) | ❌ No CLI |
| `GET /messages/tts/voices` | List TTS voices | ❌ No CLI |

### CLI Commands with Full API Coverage ✅
- `send` → All message types mapped to API routes
- `messages search` → Uses `GET /messages` with search param
- `messages read` → Uses `POST /messages/:id/read` and `POST /messages/read`
- `chats list/get/create/update/delete/archive/unarchive/messages/participants/read` → Full API coverage
- `instances list/get/create/delete/status/qr/pair/connect/disconnect/restart/logout/sync/syncs/contacts/groups/profile/update` → Full API coverage

### CLI Missing (Beyond API Gaps)
| Missing CLI Feature | API Exists | Notes |
|---------------------|------------|-------|
| `send --forward` | ✅ | Forward messages |
| `send --tts` | ✅ | TTS voice notes |
| `send --mention` | ✅ | Mentions in text |
| `messages forward` | ✅ | Alternative to send --forward |
| `tts voices` | ✅ | List available voices |

---

## 4. Quick Wins — Low Effort, High Value

### 🟢 Tier 1 — Trivial (< 1 hour each)

#### 1. Delete Message for Everyone
**Effort:** ⭐ | **Impact:** High | **Baileys:** `sendMessage(jid, { delete: key })`
```typescript
// In builders.ts, add 'delete' content type
const buildDelete: ContentBuilder = (message) => ({
  delete: {
    remoteJid: toJid(message.to),
    id: message.content.targetMessageId,
    fromMe: true, // or from metadata
  }
});
```
Currently `canDeleteMessage: true` in capabilities but no send path exists — only receive handling.

#### 2. Disappearing Messages Toggle
**Effort:** ⭐ | **Impact:** Medium | **Baileys:** `sendMessage(jid, { disappearingMessagesInChat: seconds })`
```typescript
// Values: false (off), 86400 (24h), 604800 (7d), 7776000 (90d)
```
One-liner message send, just needs API route + builder.

#### 3. Check Number on WhatsApp
**Effort:** ⭐ | **Impact:** High | **Baileys:** `onWhatsApp(...phoneNumber)`
```typescript
const [result] = await sock.onWhatsApp('+5511999999999');
// { exists: true, jid: '5511999999999@s.whatsapp.net' }
```
Super useful for validation before sending. Add route + CLI command.

#### 4. Block/Unblock Contact
**Effort:** ⭐ | **Impact:** Medium | **Baileys:** `updateBlockStatus(jid, 'block'|'unblock')`
Single Baileys call. Add API route + CLI.

#### 5. Star/Unstar Messages
**Effort:** ⭐ | **Impact:** Low | **Baileys:** `star(jid, messages, star)`
Simple call, low effort to wire up.

#### 6. Update Own Profile Status/Bio
**Effort:** ⭐ | **Impact:** Medium | **Baileys:** `updateProfileStatus(status)`
Currently we read bio but can't update it.

### 🟡 Tier 2 — Easy (1-4 hours each)

#### 7. Archive/Unarchive/Pin/Mute Chats
**Effort:** ⭐⭐ | **Impact:** High | **Baileys:** `chatModify(mod, jid)`
Four operations using `chatModify` — archive, pin, mute, clear. Needs last message tracking.

#### 8. Update Profile Picture
**Effort:** ⭐⭐ | **Impact:** Medium | **Baileys:** `updateProfilePicture(jid, content)`
Need to accept image upload, resize for WhatsApp, send. Also works for groups.

#### 9. Group Invite Link
**Effort:** ⭐⭐ | **Impact:** High | **Baileys:** `groupInviteCode(jid)` / `groupRevokeInvite(jid)`
Get/revoke group invite link. Requires existing group management setup.

#### 10. Fetch Blocklist
**Effort:** ⭐⭐ | **Impact:** Medium | **Baileys:** `fetchBlocklist()`
Return list of blocked JIDs. Add API route + CLI.

#### 11. Privacy Settings (Read)
**Effort:** ⭐⭐ | **Impact:** Medium | **Baileys:** `fetchPrivacySettings(force)`
Return all privacy settings. Good foundation for write operations.

#### 12. Reject Incoming Calls
**Effort:** ⭐⭐ | **Impact:** Medium | **Baileys:** `rejectCall(callId, callFrom)`
We already receive call events — just need to add action capability.

#### 13. Send Poll (Proper API Route)
**Effort:** ⭐⭐ | **Impact:** Medium
The WhatsApp poll builder exists in `builders.ts` but the API route is labeled as Discord-only. Need a proper `/messages/send/poll` route for WhatsApp.

### 🟠 Tier 3 — Moderate (4-16 hours each)

#### 14. Full Group Management
**Effort:** ⭐⭐⭐ | **Impact:** Very High
Add/remove participants, promote/demote, create groups, leave, update settings.
- New routes: `POST /groups/create`, `POST /groups/:id/participants`, etc.
- CLI: `groups create`, `groups add-member`, `groups promote`, etc.

#### 15. Privacy Settings (Write)
**Effort:** ⭐⭐⭐ | **Impact:** Medium
10+ individual update methods. Needs API routes for each setting or a unified settings endpoint.

#### 16. Label Management (Business)
**Effort:** ⭐⭐⭐ | **Impact:** Medium (business accounts only)
Chat labels, message labels, quick replies.

#### 17. Presence/Typing Events to API
**Effort:** ⭐⭐⭐ | **Impact:** Medium
Currently logged but not emitted. Need WebSocket or polling endpoint for real-time presence data.

#### 18. Group Event Emissions
**Effort:** ⭐⭐⭐ | **Impact:** Medium
`group-participants.update`, `group.join-request` — emit as platform events so automations can react.

### 🔴 Tier 4 — Significant (16-40+ hours each)

#### 19. Newsletter/Channel Support
**Effort:** ⭐⭐⭐⭐ | **Impact:** Medium
~20 methods. Need new entity model, routes, CLI commands. Different message model than groups.

#### 20. Community Support
**Effort:** ⭐⭐⭐⭐ | **Impact:** Medium
~20 methods. Communities are groups of groups — complex hierarchy.

#### 21. Business Catalog & Products
**Effort:** ⭐⭐⭐⭐ | **Impact:** Low (business accounts only)
Catalog, collections, products, orders. Full e-commerce integration.

#### 22. Real-Time Event Stream
**Effort:** ⭐⭐⭐⭐⭐ | **Impact:** Very High
WebSocket endpoint for real-time events (presence, typing, read receipts, group updates). Currently all events are handled internally but not streamed to consumers.

---

## 5. Feature Gap Details — Ordered by Effort

### Summary Table

| # | Feature | Effort | Impact | Baileys Methods | Status |
|---|---------|--------|--------|-----------------|--------|
| 1 | Delete for everyone | ⭐ | High | `sendMessage` + delete | Receive ✅ Send ❌ |
| 2 | Disappearing messages | ⭐ | Medium | `sendMessage` + disappearing | ❌ |
| 3 | Check on WhatsApp | ⭐ | High | `onWhatsApp` | ❌ |
| 4 | Block/unblock | ⭐ | Medium | `updateBlockStatus` | ❌ |
| 5 | Star messages | ⭐ | Low | `star` | ❌ |
| 6 | Update own bio | ⭐ | Medium | `updateProfileStatus` | Read ✅ Write ❌ |
| 7 | Archive/pin/mute | ⭐⭐ | High | `chatModify` | ❌ |
| 8 | Update profile pic | ⭐⭐ | Medium | `updateProfilePicture` | Read ✅ Write ❌ |
| 9 | Group invite links | ⭐⭐ | High | `groupInviteCode` | ❌ |
| 10 | Fetch blocklist | ⭐⭐ | Medium | `fetchBlocklist` | ❌ |
| 11 | Privacy settings (read) | ⭐⭐ | Medium | `fetchPrivacySettings` | ❌ |
| 12 | Reject calls | ⭐⭐ | Medium | `rejectCall` | ❌ |
| 13 | WhatsApp poll API route | ⭐⭐ | Medium | Already built | Plugin ✅ API ❌ |
| 14 | Group management | ⭐⭐⭐ | Very High | 15+ methods | Read ✅ Write ❌ |
| 15 | Privacy settings (write) | ⭐⭐⭐ | Medium | 10+ methods | ❌ |
| 16 | Label management | ⭐⭐⭐ | Medium | 6+ methods | Events only |
| 17 | Presence events to API | ⭐⭐⭐ | Medium | Events exist | Logged ❌ Emitted |
| 18 | Group event emissions | ⭐⭐⭐ | Medium | Events exist | Logged ❌ Emitted |
| 19 | Newsletter support | ⭐⭐⭐⭐ | Medium | 20+ methods | ❌ |
| 20 | Community support | ⭐⭐⭐⭐ | Medium | 20+ methods | ❌ |
| 21 | Business catalog | ⭐⭐⭐⭐ | Low | 6+ methods | ❌ |
| 22 | Real-time event stream | ⭐⭐⭐⭐⭐ | Very High | All events | ❌ |

### Capability Declaration Gaps

The `capabilities.ts` file has these marked as false/deferred:
```typescript
canEditMessage: false,     // Baileys DOES support edits (protocolMessage type 14)
canHandleGroups: false,    // Baileys has full group API (15+ methods)
canHandleBroadcast: false, // Baileys has newsletter API (20+ methods)
```

**`canEditMessage` should be `true`** — WhatsApp DOES support editing (since 2023). Baileys handles it via `protocolMessage.editedMessage`. Omni already receives edits but doesn't send them. The `sendMessage` function can send edits using `{ edit: WAMessageKey, text: string }` content (though not in the type definitions, it works via `relayMessage`).

### WhatsApp-Specific Baileys Features NOT Used

| Feature | Baileys Method | Notes |
|---------|---------------|-------|
| Request placeholder resend | `requestPlaceholderResend` | Re-request failed messages |
| Resync app state | `resyncAppState` | Force re-sync |
| Rotate signed pre-key | `rotateSignedPreKey` | Key rotation |
| Clean dirty bits | `cleanDirtyBits` | Sync cleanup |
| Bot list | `getBotListV2` | Get WhatsApp bots |
| Privacy tokens | `getPrivacyTokens` | For certain operations |
| USync queries | `executeUSyncQuery` | Advanced contact queries |
| LID mapping | `lid-mapping.update` event | Phone-to-LID mapping |

---

## Appendix A: File Reference

| File | Purpose |
|------|---------|
| `packages/channel-whatsapp/src/plugin.ts` | Main plugin (1973 lines) |
| `packages/channel-whatsapp/src/socket.ts` | Socket wrapper |
| `packages/channel-whatsapp/src/capabilities.ts` | Capability declarations |
| `packages/channel-whatsapp/src/handlers/messages.ts` | Message receive processing |
| `packages/channel-whatsapp/src/handlers/all-events.ts` | All event handlers |
| `packages/channel-whatsapp/src/handlers/connection.ts` | Connection management |
| `packages/channel-whatsapp/src/handlers/status.ts` | Status updates |
| `packages/channel-whatsapp/src/handlers/media.ts` | Media processing |
| `packages/channel-whatsapp/src/senders/builders.ts` | Outgoing message builders |
| `packages/channel-whatsapp/src/senders/text.ts` | Text sender |
| `packages/channel-whatsapp/src/senders/media.ts` | Media sender |
| `packages/channel-whatsapp/src/senders/reaction.ts` | Reaction sender |
| `packages/channel-whatsapp/src/senders/contact.ts` | Contact sender |
| `packages/channel-whatsapp/src/senders/location.ts` | Location sender |
| `packages/channel-whatsapp/src/senders/forward.ts` | Forward sender |
| `packages/channel-whatsapp/src/senders/sticker.ts` | Sticker sender (re-export) |
| `packages/channel-whatsapp/src/presence.ts` | Presence management |
| `packages/channel-whatsapp/src/typing.ts` | Typing indicators |
| `packages/channel-whatsapp/src/receipts.ts` | Read receipts |
| `packages/channel-whatsapp/src/auth.ts` | Auth state management |
| `packages/channel-whatsapp/src/jid.ts` | JID utilities |
| `packages/channel-whatsapp/src/types.ts` | Type definitions |
| `packages/channel-whatsapp/src/utils/audio-converter.ts` | OGG/Opus conversion |
| `packages/channel-whatsapp/src/utils/download.ts` | Media download |
| `packages/channel-whatsapp/src/utils/errors.ts` | Error mapping |
| `packages/api/src/routes/v2/messages.ts` | Message API routes |
| `packages/api/src/routes/v2/chats.ts` | Chat API routes |
| `packages/api/src/routes/v2/instances.ts` | Instance API routes |
| `packages/cli/src/commands/send.ts` | Send CLI |
| `packages/cli/src/commands/messages.ts` | Messages CLI |
| `packages/cli/src/commands/chats.ts` | Chats CLI |
| `packages/cli/src/commands/instances.ts` | Instances CLI |

## Appendix B: Baileys Documentation Links

- Introduction: https://baileys.wiki/docs/intro/
- Full API: https://baileys.wiki/docs/api/
- makeWASocket: https://baileys.wiki/docs/api/functions/makeWASocket
- BaileysEventMap: https://baileys.wiki/docs/api/type-aliases/BaileysEventMap
- AnyMessageContent: https://baileys.wiki/docs/api/type-aliases/AnyMessageContent
- ChatModification: https://baileys.wiki/docs/api/type-aliases/ChatModification
- GroupMetadata: https://baileys.wiki/docs/api/interfaces/GroupMetadata
- GitHub: https://github.com/WhiskeySockets/Baileys
