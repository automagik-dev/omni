# WISH: Automatic Media Processing on Message Receipt

> Automatically download, serve, transcribe, and describe media for every incoming message

**Status:** DRAFT
**Created:** 2026-02-06
**Author:** WISH Agent
**Beads:** omni-70d (depends on omni-3an)

---

## Problem Statement

Currently:
- Media messages show "Image not available" / "Audio not available" in the UI
- WhatsApp media requires downloading using encryption keys (not simple URLs)
- Media processing (transcription/description) exists but only runs in batch jobs
- No automatic processing pipeline for incoming messages

Users expect to see:
- Actual images, videos, audio players in chat
- Transcriptions for voice notes/audio
- Descriptions for images
- Extracted text from documents

---

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| channel-whatsapp | Download media on message receipt | Integrate with message flow |
| api | Media serving endpoint, processing trigger | New route + event handler |
| db | Add transcription/description fields | Schema migration |
| core | New event type for media processing | `media.ready` event |
| media-processing | Integrate with real-time flow | Already has processors |
| ui | Display transcriptions/descriptions | Minor UI updates |

### System Checklist

- [ ] Events: Add `media.ready` event after download
- [ ] Database: Add `transcription`, `description` fields to messages
- [ ] API: Add `/media/:id` serving endpoint
- [ ] Media storage: Configure accessible storage path
- [ ] Processing: Trigger on `media.ready` events
- [ ] UI: Show transcription/description in message bubbles

---

## Scope

### IN SCOPE

1. **Download media on receipt**
   - When `message.received` has media, download it
   - Store in accessible location (not just `./media`)
   - Emit `media.ready` event with accessible URL

2. **Serve media via API**
   - `GET /api/v2/media/:id` endpoint
   - Stream files from storage
   - Proper MIME type headers

3. **Auto-trigger processing**
   - Subscribe to `media.ready` events
   - Run appropriate processor (audio→transcribe, image→describe)
   - Update message record with results

4. **Store & display results**
   - Add `transcription` and `description` fields to messages
   - Show in UI message bubbles
   - Show processing status while in progress

### OUT OF SCOPE

- Video transcription (audio track only if needed)
- OCR for images (use vision model description instead)
- Processing historical messages (use batch jobs for that)
- External storage (S3, etc.) - use local for now

---

## Decisions

- **DEC-1**: Use event-driven flow (media.ready → process → update)
- **DEC-2**: Store media locally with API serving (not external URLs)
- **DEC-3**: Process synchronously on receive (not queued) for real-time UX
- **DEC-4**: Require API keys for processing (skip if not configured)

## Assumptions

- **ASM-1**: Groq/OpenAI API keys are configured for processing
- **ASM-2**: Local storage has sufficient space for media
- **ASM-3**: Processing latency is acceptable for real-time flow

## Risks

- **RISK-1**: Processing costs per message (mitigate: make configurable per instance)
- **RISK-2**: Storage growth (mitigate: add retention policy later)
- **RISK-3**: API rate limits (mitigate: already have retry logic)

---

## Execution Groups

### Group A: Media Download & Serving

**Goal:** Make media accessible via API URLs

**Packages:** channel-whatsapp, api, core

**Deliverables:**
- [ ] Modify WhatsApp plugin to download media on message receipt
- [ ] Store media in API-accessible location
- [ ] Create `GET /api/v2/media/:id` endpoint
- [ ] Update message record with accessible `mediaUrl`
- [ ] Emit `media.ready` event after successful download

**Acceptance Criteria:**
- [ ] Images/videos/audio display in UI instead of "not available"
- [ ] Media URLs are accessible via API
- [ ] Works for real-time and history sync messages

### Group B: Auto-Processing Pipeline

**Goal:** Automatically transcribe audio and describe images

**Packages:** api, db, media-processing

**Deliverables:**
- [ ] Add `transcription`, `description`, `processingStatus` fields to messages table
- [ ] Create `media.ready` event handler that triggers processing
- [ ] Run AudioProcessor for audio messages
- [ ] Run ImageProcessor for image messages
- [ ] Update message with processing results

**Acceptance Criteria:**
- [ ] Voice notes show transcription text
- [ ] Images show AI-generated description
- [ ] Processing happens automatically without user action
- [ ] Graceful handling when API keys not configured

### Group C: UI Display

**Goal:** Show transcriptions and descriptions in chat

**Packages:** ui

**Deliverables:**
- [ ] Display transcription below audio messages
- [ ] Display description below/as alt text for images
- [ ] Show loading state while processing
- [ ] Handle missing transcription gracefully

**Acceptance Criteria:**
- [ ] Transcriptions visible in message bubbles
- [ ] Image descriptions accessible
- [ ] Good UX for processing states

---

## Technical Design

### Media Storage Structure

```
data/media/
├── {instanceId}/
│   ├── {year}/{month}/
│   │   ├── {messageId}.jpg
│   │   ├── {messageId}.ogg
│   │   └── ...
```

### API Endpoint

```
GET /api/v2/media/:messageId
  → Stream file with correct Content-Type
  → 404 if not found
```

### Event Flow

```
message.received (with media)
  → Download media to storage
  → Update message.mediaUrl = /api/v2/media/{id}
  → Emit media.ready { messageId, mediaType, localPath }

media.ready
  → Select processor based on mediaType
  → Process file
  → Update message { transcription, description, processingStatus }
```

### Message Schema Updates

```sql
ALTER TABLE messages ADD COLUMN transcription TEXT;
ALTER TABLE messages ADD COLUMN description TEXT;
ALTER TABLE messages ADD COLUMN processing_status VARCHAR(20);
-- processing_status: null, 'pending', 'processing', 'completed', 'failed'
```

---

## Verification

```bash
# After implementation
make check
cd apps/ui && bun dev

# Test manually:
# 1. Send voice note to connected WhatsApp
# 2. Verify audio plays in UI
# 3. Verify transcription appears after processing
# 4. Send image, verify description appears
```

---

## Questions

1. **Processing toggle**: Should auto-processing be configurable per instance?
2. **Cost tracking**: Should we show processing costs in UI?
3. **Language**: Default to Portuguese or detect automatically?
