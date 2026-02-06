# WISH: Media Download & Serving via API

> Download WhatsApp media on message receipt and serve via API endpoint

**Status:** DRAFT
**Created:** 2026-02-06
**Author:** WISH Agent
**Beads:** omni-3an

---

## Problem Statement

Currently:
- WhatsApp media requires downloading using encryption keys
- `mediaUrl` in messages is null (no accessible URL)
- UI shows "Image not available" / "Audio not available"
- Media download handler exists but isn't integrated with message flow

Users expect to see actual media content in chats.

---

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| channel-whatsapp | Integrate media download with message flow | Use existing download utils |
| api | Add media serving endpoint | `GET /api/v2/media/:id` |
| core | Add `media.ready` event type | For downstream processing |
| db | No schema changes | Uses existing `mediaUrl` field |

### System Checklist

- [ ] Events: Add `media.ready` event type
- [ ] API: Add media serving route
- [ ] Storage: Configure media storage path
- [ ] Channel: Download on message receipt

---

## Scope

### IN SCOPE

1. **Download media on message receipt**
   - Integrate with `handleMessageReceived` flow
   - Download to configured storage path
   - Support image, video, audio, document, sticker

2. **API serving endpoint**
   - `GET /api/v2/media/:messageId`
   - Stream file with correct Content-Type
   - Basic auth/access control

3. **Update message records**
   - Set `mediaUrl` to API endpoint URL
   - Emit `media.ready` event for downstream processing

### OUT OF SCOPE

- External storage (S3, GCS) - local storage only
- Transcription/description (separate wish)
- Media upload (sending media)
- Thumbnail generation

---

## Decisions

- **DEC-1**: Store media locally under `data/media/`
- **DEC-2**: Organize by `{instanceId}/{year}/{month}/{messageId}.{ext}`
- **DEC-3**: Serve via API (not static files) for access control
- **DEC-4**: Download synchronously in message flow (don't defer)

## Assumptions

- **ASM-1**: Local disk has sufficient space
- **ASM-2**: Download completes before message is emitted

## Risks

- **RISK-1**: Download latency slows message processing
  - Mitigate: Set timeout, emit message even if download fails
- **RISK-2**: Disk space growth
  - Mitigate: Add retention/cleanup job later

---

## Execution Groups

### Group A: Channel Integration

**Goal:** Download media when messages arrive

**Packages:** channel-whatsapp

**Deliverables:**
- [ ] Call `downloadMedia` in `handleMessageReceived` for media messages
- [ ] Store files in `data/media/{instanceId}/{year}/{month}/`
- [ ] Add `mediaUrl` to message content (local path for now)
- [ ] Handle download failures gracefully (log, continue)

**Acceptance Criteria:**
- [ ] Media files appear in storage directory
- [ ] Message flow not broken by download failures
- [ ] Works for all media types

### Group B: API Serving

**Goal:** Serve media files via HTTP

**Packages:** api, core

**Deliverables:**
- [ ] Add `GET /api/v2/media/:messageId` route
- [ ] Stream file from storage with correct MIME type
- [ ] Add `media.ready` event type to core
- [ ] Emit `media.ready` after successful download
- [ ] Update messages to use API URL instead of local path

**Acceptance Criteria:**
- [ ] Media accessible at `/api/v2/media/{id}`
- [ ] Correct Content-Type headers
- [ ] 404 for missing media
- [ ] UI displays media instead of "not available"

---

## Technical Design

### Storage Layout

```
data/media/
└── {instanceId}/
    └── 2026/02/
        ├── msg_abc123.jpg
        ├── msg_def456.ogg
        └── msg_ghi789.mp4
```

### API Route

```typescript
// packages/api/src/routes/v2/media.ts
app.get('/media/:messageId', async (c) => {
  const { messageId } = c.req.param();
  const message = await services.messages.getById(messageId);

  if (!message?.mediaLocalPath) {
    return c.notFound();
  }

  const stream = createReadStream(message.mediaLocalPath);
  return c.body(stream, {
    headers: { 'Content-Type': message.mediaMimeType }
  });
});
```

### Message Flow Update

```typescript
// In handleMessageReceived
if (hasMedia(msg)) {
  const mediaPath = await downloadMedia(msg, storageBasePath);
  if (mediaPath) {
    content.mediaUrl = `/api/v2/media/${externalId}`;
    content.mediaLocalPath = mediaPath; // for internal use
  }
}
```

---

## Verification

```bash
make check

# Manual test:
# 1. Send image/audio to WhatsApp instance
# 2. Check data/media/ for downloaded file
# 3. GET /api/v2/media/{messageId} returns file
# 4. UI shows actual media
```
