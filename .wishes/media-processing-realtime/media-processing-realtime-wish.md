# WISH: Media Processing - Real-time Per-Message

**Status:** DRAFT
**Beads:** omni-1mj
**Priority:** P0

## Context

Omni v1 has a production-grade media processing system that automatically processes audio, images, videos, and documents as messages arrive. This happens **before debounce** to ensure transcripts are immediately available.

**V1 Reference Files:**
- `/home/cezar/dev/omni/src/services/media_processing/service.py` - MediaProcessingService
- `/home/cezar/dev/omni/src/services/media_processing/processors/` - All processors
- `/home/cezar/dev/omni/src/channels/whatsapp/handlers.py` (lines 509-956) - Integration
- `/home/cezar/dev/omni/src/services/media_processing/pricing.py` - Cost tracking
- `/home/cezar/dev/omni/src/db/trace_models.py` - MediaContent table

## Problem Statement

V2 currently has **no media processing capability**. When a user sends an audio message, image, or document, v2 cannot:
- Transcribe audio to text
- Describe image contents
- Extract document text
- Track processing costs

This is a critical v1 feature required for parity.

## Scope

### IN SCOPE

1. **Database Schema**
   - `media_content` table for storing processed results
   - Cost tracking columns (penny-accurate Decimal precision)
   - Processor metadata (name, model, confidence, timing)

2. **Processor Architecture**
   - `BaseProcessor` abstract class
   - `ProcessingResult` data class
   - Processor registry pattern

3. **Audio Processor**
   - Primary: Groq Whisper (whisper-large-v3-turbo) - $0.04/hour, 216x realtime
   - Fallback: OpenAI Whisper-1 - $0.006/minute
   - Retry with exponential backoff on rate limits
   - Language detection (default: Portuguese)

4. **Image Processor**
   - Primary: Gemini Vision (gemini-2.5-flash)
   - Fallback: OpenAI Vision (gpt-4o-mini or gpt-5-nano)
   - Custom prompts with caption context

5. **Video Processor**
   - Gemini Video API with File upload
   - Full dialogue/speech extraction
   - Scene description

6. **Document Processor**
   - PDF (text): PyMuPDF (local, free)
   - PDF (scanned): Gemini Vision OCR fallback
   - Word (DOCX): python-docx (local, free)
   - Excel (XLSX): openpyxl (local, free)
   - Text files: Direct read

7. **Channel Integration**
   - WhatsApp: Process in `channel-whatsapp` message handler
   - Discord: Process in `channel-discord` message handler
   - Processing happens BEFORE debounce

8. **Cost Tracking**
   - Per-processor pricing registry
   - Decimal(10,8) precision for USD amounts
   - Token counting for LLM-based processors
   - Duration-based pricing for audio

### OUT OF SCOPE

- Batch job system (separate wish: media-processing-batch)
- UI for viewing processed content
- Search/indexing of processed text
- Configurable processor preferences per instance

## Technical Design

### Database Schema

```typescript
// packages/db/src/schema.ts additions

export const mediaContent = pgTable('media_content', {
  id: serial('id').primaryKey(),
  instanceId: text('instance_id').references(() => instances.id),
  channelType: text('channel_type').notNull(), // 'whatsapp' | 'discord'
  originalMessageId: text('original_message_id').notNull(),
  senderId: text('sender_id'),

  // Processing metadata
  contentType: text('content_type').notNull(), // 'audio_transcript' | 'image_description' | 'video_description' | 'document_content'
  sourceMediaType: text('source_media_type').notNull(), // 'audio' | 'image' | 'video' | 'document'
  processorName: text('processor_name').notNull(), // 'groq_whisper' | 'gemini_vision' | etc
  processorModel: text('processor_model'), // 'whisper-large-v3-turbo' | etc

  // Results
  content: text('content'), // The extracted/transcribed text
  contentFormat: text('content_format').default('text'), // 'text' | 'markdown'
  processingTimeMs: integer('processing_time_ms'),
  confidenceScore: integer('confidence_score'), // 0-100
  status: text('status').notNull().default('pending'), // 'pending' | 'processing' | 'completed' | 'failed'
  errorMessage: text('error_message'),

  // Cost tracking (USD, 10-digit precision)
  costInputUsd: numeric('cost_input_usd', { precision: 12, scale: 8 }),
  costOutputUsd: numeric('cost_output_usd', { precision: 12, scale: 8 }),
  costTotalUsd: numeric('cost_total_usd', { precision: 12, scale: 8 }),

  // Token usage
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),

  // Pricing audit
  pricingModel: text('pricing_model'),
  pricingRateInput: numeric('pricing_rate_input', { precision: 12, scale: 8 }),
  pricingRateOutput: numeric('pricing_rate_output', { precision: 12, scale: 8 }),

  // Source media
  mediaUrl: text('media_url'),
  mediaMimeType: text('media_mime_type'),
  mediaSizeBytes: integer('media_size_bytes'),
  mediaDurationSeconds: integer('media_duration_seconds'), // For audio/video
  mediaSha256: text('media_sha256'), // For deduplication

  // Batch job reference (if from batch processing)
  batchJobId: text('batch_job_id'),

  processedAt: timestamp('processed_at'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

### Processor Interface

```typescript
// packages/core/src/media-processing/types.ts

export interface ProcessingResult {
  content: string;
  contentFormat: 'text' | 'markdown';
  processorName: string;
  processorModel: string;
  processingTimeMs: number;
  confidenceScore?: number;
  inputTokens?: number;
  outputTokens?: number;
  costInputUsd: Decimal;
  costOutputUsd: Decimal;
  costTotalUsd: Decimal;
  mediaDurationSeconds?: number;
}

export abstract class BaseProcessor {
  abstract readonly processorName: string;
  abstract readonly supportedMimeTypes: string[];

  abstract process(
    filePath: string,
    mimeType: string,
    options?: ProcessorOptions
  ): Promise<ProcessingResult>;
}
```

### Pricing Registry

```typescript
// packages/core/src/media-processing/pricing.ts

export const PRICING = {
  groq_whisper: {
    'whisper-large-v3-turbo': { unit: 'hour', rate: 0.04 },
    'whisper-large-v3': { unit: 'hour', rate: 0.111 },
    'distil-whisper-large-v3-en': { unit: 'hour', rate: 0.02 },
  },
  openai_whisper: {
    'whisper-1': { unit: 'minute', rate: 0.006 },
  },
  gemini_vision: {
    'gemini-2.5-flash': { unit: 'million_tokens', inputRate: 0.15, outputRate: 0.60 },
    'gemini-2.0-flash': { unit: 'million_tokens', inputRate: 0.10, outputRate: 0.40 },
  },
  openai_vision: {
    'gpt-4o-mini': { unit: 'million_tokens', inputRate: 0.15, outputRate: 0.60 },
    'gpt-5-nano': { unit: 'million_tokens', inputRate: 0.05, outputRate: 0.40 },
  },
  local: {
    'pymupdf': { unit: 'free', rate: 0 },
    'python-docx': { unit: 'free', rate: 0 },
    'openpyxl': { unit: 'free', rate: 0 },
  },
};
```

## Implementation Groups

### Group 1: Foundation
- [ ] Add `media_content` table to DB schema
- [ ] Create `BaseProcessor` and `ProcessingResult` types
- [ ] Create pricing registry
- [ ] Create `MediaProcessingService` class

### Group 2: Processors
- [ ] Implement `AudioProcessor` (Groq → OpenAI fallback)
- [ ] Implement `ImageProcessor` (Gemini → OpenAI fallback)
- [ ] Implement `VideoProcessor` (Gemini File API)
- [ ] Implement `DocumentProcessor` (PyMuPDF → Gemini OCR)

### Group 3: Channel Integration
- [ ] Integrate with `channel-whatsapp` message handler
- [ ] Integrate with `channel-discord` message handler
- [ ] Add settings for enable/disable per instance

### Group 4: API & Testing
- [ ] Add API endpoints for querying MediaContent
- [ ] Add tests for each processor
- [ ] Add integration tests

## Success Criteria

- [ ] Audio messages are automatically transcribed when received
- [ ] Images get descriptions generated
- [ ] Documents have text extracted
- [ ] Cost tracking is penny-accurate
- [ ] Fallback processors work when primary fails
- [ ] Processing happens before debounce (immediate availability)

## Dependencies

- `@omni/core` - Event bus, schemas
- `@omni/db` - Database schema
- `@omni/channel-whatsapp` - WhatsApp integration
- `@omni/channel-discord` - Discord integration

## External Dependencies (NPM)

- `groq-sdk` - Groq Whisper API
- `openai` - OpenAI Whisper/Vision API
- `@google/generative-ai` - Gemini API
- `mupdf` or `pdf-parse` - PDF text extraction
- `mammoth` - Word document extraction
- `xlsx` - Excel extraction
