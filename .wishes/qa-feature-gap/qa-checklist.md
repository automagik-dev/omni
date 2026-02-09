# Omni v2 — Feature QA Checklist

**Instance:** Genie (`07a5178e`) with `Omni:>` prefix
**Date:** 2026-02-09
**Rule:** HUMANIZED — minimum 5s between tests, logs streaming

---

## 📨 MESSAGING (what I can do)

| # | Feature | API Endpoint | CLI | Status | Notes |
|---|---------|-------------|-----|--------|-------|
| M1 | Send text | `POST /messages/send` | `omni messages send` | 🟡 | Test in group |
| M2 | Send image | `POST /messages/send/media` | `omni messages send-media` | ⬜ | |
| M3 | Send video | `POST /messages/send/media` | — | ⬜ | |
| M4 | Send audio/voice note | `POST /messages/send/media` | — | ⬜ | PTT flag |
| M5 | Send document | `POST /messages/send/media` | — | ⬜ | |
| M6 | Send sticker | `POST /messages/send/sticker` | — | ⬜ | |
| M7 | Send contact card | `POST /messages/send/contact` | — | ⬜ | |
| M8 | Send location | `POST /messages/send/location` | — | ⬜ | |
| M9 | Send reaction | `POST /messages/send/reaction` | — | ⬜ | |
| M10 | Send poll | `POST /messages/send/poll` | — | ⬜ | |
| M11 | Send TTS voice | `POST /messages/send/tts` | — | ⬜ | ElevenLabs |
| M12 | Forward message | `POST /messages/send/forward` | — | ⬜ | |
| M13 | Reply to message | `POST /messages/send` + replyTo | — | ⬜ | |
| M14 | Edit message | `POST /messages/edit-channel` | — | ⬜ | |
| M15 | Delete message | `POST /messages/delete-channel` | — | ⬜ | |
| M16 | Star message | `POST /messages/:id/star` | — | ⬜ | |
| M17 | Mark as read | `POST /messages/:id/read` | — | ⬜ | |
| M18 | Send typing/presence | `POST /messages/send/presence` | — | ⬜ | |
| M19 | Send w/ mentions | `POST /messages/send` + mentions | — | ⬜ | |

## 💬 CHAT MANAGEMENT (what I can do)

| # | Feature | API Endpoint | CLI | Status | Notes |
|---|---------|-------------|-----|--------|-------|
| C1 | List chats | `GET /chats` | `omni chats list` | ⬜ | |
| C2 | Archive chat | `POST /chats/:id/archive` | — | ⬜ | |
| C3 | Unarchive chat | `POST /chats/:id/unarchive` | — | ⬜ | |
| C4 | Pin chat | `POST /chats/:id/pin` | — | ⬜ | |
| C5 | Unpin chat | `POST /chats/:id/unpin` | — | ⬜ | |
| C6 | Mute chat | `POST /chats/:id/mute` | — | ⬜ | |
| C7 | Unmute chat | `POST /chats/:id/unmute` | — | ⬜ | |
| C8 | Disappearing messages | `POST /chats/:id/disappearing` | — | ⬜ | |
| C9 | Mark chat read | `POST /chats/:id/read` | — | ⬜ | |
| C10 | Get participants | `GET /chats/:id/participants` | — | ⬜ | |
| C11 | Add participant | `POST /chats/:id/participants` | — | ⬜ | |
| C12 | Remove participant | `DELETE /chats/:id/participants/:uid` | — | ⬜ | |

## 👤 PROFILE & CONTACTS (what I can do)

| # | Feature | API Endpoint | CLI | Status | Notes |
|---|---------|-------------|-----|--------|-------|
| P1 | Update profile name | `PUT /instances/:id/profile/name` | `omni instances update-name` | ✅ | Tested |
| P2 | Update bio/status | `PUT /instances/:id/profile/status` | `omni instances update-bio` | ✅ | Tested |
| P3 | Update profile pic | `PUT /instances/:id/profile/picture` | `omni instances update-picture` | ✅ | Tested (oops) |
| P4 | Remove profile pic | `DELETE /instances/:id/profile/picture` | — | ✅ | Tested (revert) |
| P5 | Check number | `POST /instances/:id/check-number` | `omni instances check-number` | ✅ | Tested |
| P6 | Block contact | `POST /instances/:id/block` | `omni instances block` | ✅ | Tested |
| P7 | Unblock contact | `DELETE /instances/:id/block` | `omni instances unblock` | ✅ | Tested |
| P8 | Get blocklist | `GET /instances/:id/blocklist` | `omni instances blocklist` | ✅ | Tested |
| P9 | Get user profile | `GET /instances/:id/users/:uid/profile` | — | ⬜ | |
| P10 | List contacts | `GET /instances/:id/contacts` | — | ⬜ | |
| P11 | Privacy settings | `GET /instances/:id/privacy` | — | ⬜ | |

## 👥 GROUPS (what I can do)

| # | Feature | API Endpoint | CLI | Status | Notes |
|---|---------|-------------|-----|--------|-------|
| G1 | Create group | `POST /instances/:id/groups` | `omni instances group-create` | ✅ | Tested |
| G2 | List groups | `GET /instances/:id/groups` | — | ⬜ | |
| G3 | Get invite link | `GET /instances/:id/groups/:jid/invite` | — | ⬜ | |
| G4 | Revoke invite | `POST /instances/:id/groups/:jid/invite/revoke` | — | ⬜ | |
| G5 | Join via code | `POST /instances/:id/groups/join` | — | ⬜ | |
| G6 | Update group pic | `PUT /instances/:id/groups/:jid/picture` | — | ✅ | Just added |

## 🔧 INSTANCE MANAGEMENT

| # | Feature | API Endpoint | CLI | Status | Notes |
|---|---------|-------------|-----|--------|-------|
| I1 | List instances | `GET /instances` | `omni instances list` | ✅ | Works |
| I2 | Get instance | `GET /instances/:id` | `omni instances get` | ✅ | Works |
| I3 | Restart instance | `POST /instances/:id/restart` | — | ✅ | Tested |
| I4 | Get QR code | `GET /instances/:id/qr` | — | ✅ | Tested |
| I5 | Disconnect | `POST /instances/:id/disconnect` | — | ✅ | Tested |
| I6 | Logout | `POST /instances/:id/logout` | — | ✅ | Tested |
| I7 | Sync history | `POST /instances/:id/sync` | — | ⬜ | |
| I8 | Health check | `GET /health` | — | ✅ | Works |

---

## 🚫 FEATURE GAPS (what a human can do but I can't yet)

| # | Feature | WhatsApp Has | Omni Has | Difficulty |
|---|---------|-------------|----------|------------|
| GAP1 | Send to multiple recipients (broadcast) | ✅ | ❌ | Medium |
| GAP2 | View/delete status/stories | ✅ | ❌ | Hard (Baileys limitation) |
| GAP3 | Voice/video calls | ✅ | ❌ rejectCall only | Very Hard |
| GAP4 | Payment/transfers | ✅ | ❌ | N/A (Meta API) |
| GAP5 | Community management | ✅ | ❌ | Medium |
| GAP6 | Channel management (broadcast channels) | ✅ | ❌ | Medium |
| GAP7 | Group admin settings (restrict, announce) | ✅ | ❌ | Easy |
| GAP8 | Group description update | ✅ | ❌ | Easy |
| GAP9 | Pinned messages in chat | ✅ | ❌ | Easy |
| GAP10 | Search messages | ✅ | Partial (DB only) | Easy |
| GAP11 | Media auto-download settings | ✅ | ❌ | Easy |
| GAP12 | Link preview control | ✅ | Partial | Easy |
| GAP13 | Schedule messages | ✅ (Business) | ❌ | Medium |
| GAP14 | Labels (Business) | ✅ | ❌ | Medium |
| GAP15 | Quick replies (Business) | ✅ | ❌ | Medium |
| GAP16 | Catalog/Products (Business) | ✅ | ❌ | Hard |
| GAP17 | Newsletter/Channels | ✅ | ❌ | Medium |

---

## 📊 SCORE

- **Total API features:** ~50
- **Tested & working:** ~15 (✅)
- **Untested:** ~35 (⬜)
- **Feature gaps vs human:** ~17

**Test order (by risk/importance):**
1. M1-M4 — Core messaging (text, image, video, audio)
2. M9 — Reactions
3. M13 — Reply to message
4. M14-M15 — Edit/Delete
5. C1-C9 — Chat management
6. G2-G5 — Group features
7. M5-M12 — Extended messaging

_Ready to test. Humanized. One by one. 🐙_
