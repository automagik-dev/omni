---
title: "Baileys Deep Dive: JIDs, Mentions, and Groups"
created: 2026-02-09
updated: 2026-02-09
tags: [baileys, whatsapp, jid, mentions, groups, research]
status: current
source: "packages/channel-whatsapp/src/plugin.ts"
---

# Baileys Deep Dive: JIDs, Mentions, and Groups

_Omni's reference guide for WhatsApp identity and messaging via Baileys 7.0.0-rc.9_

> Related: [[overview|Architecture Overview]], [[plugin-system|Plugin System]]

---

## 1. JID System (Jabber IDs)

WhatsApp uses XMPP-style JIDs to identify every entity. Understanding JIDs is foundational.

### JID Format: `{identifier}@{server}`

| Type | Server | Example | Notes |
|------|--------|---------|-------|
| **User (PN)** | `s.whatsapp.net` | `5511999999999@s.whatsapp.net` | Phone number based |
| **User (LID)** | `lid` | `abc123@lid` | Linked ID, privacy-preserving |
| **Group** | `g.us` | `120363012345678901@g.us` | Auto-generated group ID |
| **Broadcast** | `broadcast` | `status@broadcast` | Status/broadcast lists |
| **Newsletter** | `newsletter` | `120363012345678901@newsletter` | Channels (read-only) |
| **Bot** | `bot` | `13135550002@bot` | Meta AI and bots |
| **Hosted** | `hosted` | `xyz@hosted` | Hosted numbers |

### Key Functions from `WABinary/jid-utils`

```typescript
import {
  jidEncode,        // Build JID: jidEncode('5511999', 's.whatsapp.net') → '5511999@s.whatsapp.net'
  jidDecode,        // Parse JID: { user: '5511999', server: 's.whatsapp.net', device?: 0 }
  jidNormalizedUser, // Normalize: strips device info, returns canonical JID
  areJidsSameUser,  // Compare ignoring device
  isJidGroup,       // Checks @g.us
  isJidUser,        // DOES NOT EXIST — use !isJidGroup && !isJidBroadcast
  isJidBroadcast,   // Checks @broadcast
  isJidNewsletter,  // Checks @newsletter
  isLidUser,        // Checks @lid
  isJidBot,         // Checks @bot
} from '@whiskeysockets/baileys';
```

### Phone → JID Conversion

```typescript
// Simple: just append @s.whatsapp.net
const userJid = `${phoneNumber.replace(/\D/g, '')}@s.whatsapp.net`;

// Better: verify the number exists on WhatsApp first
const [result] = await sock.onWhatsApp('+5511999999999');
if (result?.exists) {
  const jid = result.jid; // Returns the canonical JID
}
```

### PN vs LID (Critical!)

WhatsApp has two addressing modes:
- **PN (Phone Number)**: Traditional `@s.whatsapp.net` JIDs
- **LID (Linked ID)**: Privacy-preserving `@lid` JIDs — you can't derive the phone number from these

Groups can use either mode (check `GroupMetadata.addressingMode`):
- `"pn"` → participants identified by phone JIDs
- `"lid"` → participants identified by LID JIDs

**Omni currently assumes PN everywhere.** LID support would need a mapping layer.

### Our `toJid()` Implementation (Omni)

Location: `packages/channel-whatsapp/src/jid.ts`

```typescript
export function toJid(identifier: string): string {
  if (identifier.includes('@')) return identifier; // Already a JID
  const cleaned = identifier.replace(/\D/g, ''); // Strip non-digits
  return `${cleaned}@s.whatsapp.net`;
}
```

**⚠️ Issue:** This always produces `@s.whatsapp.net` — it can't handle group JIDs from raw IDs. We have `toGroupJid()` for that, but callers need to know which to use.

---

## 2. @ Mentions

### How Mentions Work in WhatsApp

Mentions require **two things** simultaneously:
1. **`mentions` array**: List of JIDs to mention
2. **`@{phone}` in text**: The text must contain `@` + phone number where the mention renders

Without BOTH, the mention either doesn't render or doesn't notify.

### Baileys Message Type for Mentions

```typescript
// From Types/Message.d.ts
type Mentionable = {
  /** list of jids that are mentioned in the accompanying text */
  mentions?: string[];
};

// Text messages are: { text: string } & Mentionable & Contextable & Editable
// Image/video captions also support: & Mentionable
```

### Correct Way to Send a Mention

```typescript
await sock.sendMessage(groupJid, {
  text: 'Hey @5511999999999, check this out!',
  mentions: ['5511999999999@s.whatsapp.net']
});
```

**The `@` in text uses the PHONE NUMBER (no country code prefix issues, just digits).**
**The `mentions` array uses FULL JIDs.**

### What About LID Groups?

In LID-addressed groups, mentions work differently:
- The `mentions` array should contain LID JIDs
- The text should contain `@{lidUser}` (the part before `@lid`)
- **We don't support this yet**

### Our Current Implementation (and what's wrong)

Location: `packages/channel-whatsapp/src/senders/builders.ts`, `buildText()`

```typescript
// Current logic:
const mentionJids = userMentions.map((m) => toMentionJid(m.id));
// toMentionJid: strips non-digits, appends @s.whatsapp.net

// Then checks if text already has @mentions:
for (const mention of userMentions) {
  const phoneNumber = mention.id.replace(/\D/g, '');
  if (!text.includes(`@${phoneNumber}`)) {
    text = `@${phoneNumber} ${text}`; // PREPENDS if missing
  }
}
```

**Issues found:**
1. ✅ JID construction is correct (`@s.whatsapp.net`)
2. ✅ Text includes `@{phone}` — correct
3. ⚠️ Prepending mentions to text looks ugly: `@5511999 Hey everyone!` instead of natural placement
4. ⚠️ No LID support
5. ⚠️ Media messages with captions don't pass `mentions` — only `buildText` handles it

### API Contract for Mentions

Location: `packages/api/src/routes/v2/messages.ts`

```typescript
// POST /messages/send
{
  instanceId: "uuid",
  to: "+5511999999999",
  text: "Hey @5511999999999, look at this!",
  mentions: [
    { id: "5511999999999", type: "user" }  // type defaults to "user"
  ]
}
```

The `id` field should be the phone number (digits only or with JID suffix).

---

## 3. Group Management

### Creating Groups

```typescript
const result: GroupMetadata = await sock.groupCreate(
  'Group Subject',           // Group name (subject)
  ['5511999@s.whatsapp.net'] // Participant JIDs
);
// Returns: { id: '120363...@g.us', subject: 'Group Subject', participants: [...], ... }
```

### Full Group API

```typescript
// Core
sock.groupCreate(subject, participants)        → GroupMetadata
sock.groupMetadata(groupJid)                   → GroupMetadata
sock.groupLeave(groupJid)                      → void
sock.groupFetchAllParticipating()              → { [jid]: GroupMetadata }

// Subject & Description
sock.groupUpdateSubject(jid, newSubject)        → void
sock.groupUpdateDescription(jid, description?)  → void

// Participants
sock.groupParticipantsUpdate(jid, participants, action)
//   action: 'add' | 'remove' | 'promote' | 'demote' | 'modify'
//   Returns: { status, jid, content }[]

// Join Requests (approval mode groups)
sock.groupRequestParticipantsList(jid)          → { [key]: string }[]
sock.groupRequestParticipantsUpdate(jid, participants, 'approve'|'reject')

// Invite Links
sock.groupInviteCode(jid)                       → string
sock.groupRevokeInvite(jid)                     → string
sock.groupAcceptInvite(code)                    → string (group JID)
sock.groupGetInviteInfo(code)                   → GroupMetadata

// V4 Invites (in-message group invites)
sock.groupAcceptInviteV4(key, inviteMessage)
sock.groupRevokeInviteV4(groupJid, invitedJid)

// Settings
sock.groupSettingUpdate(jid, 'announcement'|'not_announcement'|'locked'|'unlocked')
sock.groupToggleEphemeral(jid, seconds)         // Disappearing messages
sock.groupMemberAddMode(jid, 'admin_add'|'all_member_add')
sock.groupJoinApprovalMode(jid, 'on'|'off')
```

### GroupMetadata Shape

```typescript
interface GroupMetadata {
  id: string;                    // Group JID (xxx@g.us)
  owner: string | undefined;    // Owner's JID
  subject: string;              // Group name
  subjectOwner?: string;        // Who set the subject
  subjectTime?: number;         // When subject was set
  creation?: number;            // Creation timestamp
  desc?: string;                // Group description
  descOwner?: string;           // Who set description
  addressingMode?: 'pn' | 'lid'; // How members are identified
  linkedParent?: string;        // Community JID if part of community
  restrict?: boolean;           // Only admins change settings
  announce?: boolean;           // Only admins send messages
  memberAddMode?: boolean;      // Non-admins can add members
  joinApprovalMode?: boolean;   // Requires approval to join
  isCommunity?: boolean;
  isCommunityAnnounce?: boolean;
  size?: number;                // Participant count
  participants: GroupParticipant[];
  ephemeralDuration?: number;   // Disappearing messages timer
  inviteCode?: string;
}

type GroupParticipant = Contact & {
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  admin?: 'admin' | 'superadmin' | null;
};
```

---

## 4. Implementation Plan for Omni

### Feature: `groupCreate`

**Plugin method:**
```typescript
async groupCreate(instanceId: string, subject: string, participants: string[]): Promise<GroupMetadata> {
  const sock = this.getSocket(instanceId);
  const jids = participants.map(p => toJid(p)); // phone→JID
  return sock.groupCreate(subject, jids);
}
```

**API route:** `POST /instances/:id/groups`
```typescript
// Schema
{ subject: string, participants: string[] }
// Response: GroupMetadata
```

**CLI command:** `omni instances group-create <instanceId> --subject "Name" --participants "+55..." "+55..."`

### Feature: Fix @ Mentions

1. Don't prepend mentions — let the user place `@phone` in text naturally
2. Support mentions in image/video captions
3. Validate mention JIDs with `onWhatsApp()` (optional, performance trade-off)

### Feature: Group Management Suite (Future)

- `POST /instances/:id/groups` — create group
- `GET /instances/:id/groups/:groupId` — get metadata
- `PUT /instances/:id/groups/:groupId` — update subject/description
- `POST /instances/:id/groups/:groupId/participants` — add/remove/promote/demote
- `GET /instances/:id/groups/:groupId/invite` — get invite code
- `POST /instances/:id/groups/:groupId/invite/revoke` — revoke invite

---

_Last updated: 2026-02-08 — Omni 🐙_
