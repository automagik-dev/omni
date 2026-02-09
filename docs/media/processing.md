---
title: "Media Processing Pipeline"
created: 2025-01-29
updated: 2026-02-09
tags: [media, processing, transcription, vision]
status: current
---

# Media Processing Pipeline

> Omni v2 processes media (audio, images, video, documents) to extract text content for LLM consumption. This enables AI agents to understand voice messages, images, and documents.

> Related: [[overview|Architecture Overview]], [[event-system|Event System]]

## Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        MEDIA PROCESSING PIPELINE                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  media.received event                                                    │
│         │                                                                │
│         ▼                                                                │
│  ┌──────────────┐                                                       │
│  │  DISPATCHER  │  Routes to appropriate processor                      │
│  └──────┬───────┘                                                       │
│         │                                                                │
│    ┌────┴────┬─────────┬─────────┐                                      │
│    │         │         │         │                                       │
│    ▼         ▼         ▼         ▼                                       │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                                    │
│ │AUDIO │ │IMAGE │ │VIDEO │ │ DOC  │                                    │
│ │      │ │      │ │      │ │      │                                    │
│ │Groq  │ │Gemini│ │Gemini│ │PyMuPDF│                                   │
│ │Whisper│ │Vision│ │Vision│ │Gemini │                                   │
│ └──┬───┘ └──┬───┘ └──┬───┘ └──┬───┘                                    │
│    │        │        │        │                                         │
│    └────────┴────────┴────────┘                                         │
│                  │                                                       │
│                  ▼                                                       │
│         ┌──────────────┐                                                │
│         │    STORAGE   │  Store result + emit event                     │
│         └──────────────┘                                                │
│                  │                                                       │
│                  ▼                                                       │
│         media.processed event                                            │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Supported Media Types

| Type | Extensions | Primary Provider | Fallback |
|------|------------|------------------|----------|
| **Audio** | ogg, opus, mp3, wav, m4a, webm | Groq Whisper | OpenAI Whisper |
| **Image** | jpg, png, gif, webp | Google Gemini | OpenAI GPT-4V |
| **Video** | mp4, mov, avi, webm | Google Gemini | - |
| **Document** | pdf, docx, txt | PyMuPDF + Gemini | OpenAI |

## Configuration

### Environment Variables

```bash
# Primary providers
GROQ_API_KEY=gsk_...          # Audio transcription (fast, cheap)
GEMINI_API_KEY=AIza...        # Images, video, scanned PDFs

# Fallback provider
OPENAI_API_KEY=sk-...         # Fallback for all media types

# Optional configuration
MEDIA_PROCESSING_TIMEOUT=60000          # Timeout per file (ms)
MEDIA_MAX_FILE_SIZE=67108864            # Max file size (64MB)
MEDIA_RETRY_ATTEMPTS=3                  # Retry count
MEDIA_RETRY_DELAY=2000                  # Initial retry delay (ms)
```

### Instance-Level Settings

Each instance can configure which media types to process:

```typescript
const instance = await omni.instances.create({
  name: 'my-instance',
  channel: 'whatsapp-baileys',
  media: {
    processAudio: true,      // Transcribe voice messages
    processImages: true,     // Describe images
    processVideo: true,      // Describe video content
    processDocuments: true,  // Extract document text
    processOnBlocked: false, // Process media even if sender is blocked
  },
});
```

### Global Settings

```typescript
// Settings UI or API
await omni.settings.setMany({
  GROQ_API_KEY: 'gsk_...',
  GEMINI_API_KEY: 'AIza...',
  OPENAI_API_KEY: 'sk-...',
});
```

## Processor Implementations

### Audio Processor (Transcription)

```typescript
// packages/core/src/media/processors/audio.ts

export class AudioProcessor implements MediaProcessor {
  readonly type = 'transcription';
  readonly supportedMimeTypes = [
    'audio/ogg',
    'audio/opus',
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/webm',
    'audio/m4a',
    'audio/x-m4a',
  ];

  constructor(private config: AudioProcessorConfig) {}

  async process(media: MediaInput): Promise<ProcessingResult> {
    const providers = this.getProviderOrder();

    for (const provider of providers) {
      try {
        return await this.processWithProvider(media, provider);
      } catch (error) {
        this.logger.warn(`${provider} failed, trying next:`, error);
        if (provider === providers[providers.length - 1]) {
          throw error; // Last provider, throw
        }
      }
    }

    throw new Error('All providers failed');
  }

  private getProviderOrder(): AudioProvider[] {
    // Prefer Groq (faster, cheaper), fallback to OpenAI
    const providers: AudioProvider[] = [];
    if (this.config.groqApiKey) providers.push('groq');
    if (this.config.openaiApiKey) providers.push('openai');
    return providers;
  }

  private async processWithProvider(
    media: MediaInput,
    provider: AudioProvider
  ): Promise<ProcessingResult> {
    const formData = new FormData();
    formData.append('file', new Blob([media.buffer], { type: media.mimeType }), 'audio.ogg');
    formData.append('model', 'whisper-large-v3');
    formData.append('response_format', 'verbose_json');

    const baseUrl = provider === 'groq'
      ? 'https://api.groq.com/openai/v1'
      : 'https://api.openai.com/v1';

    const apiKey = provider === 'groq'
      ? this.config.groqApiKey
      : this.config.openaiApiKey;

    const response = await this.fetchWithRetry(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData,
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message);
    }

    return {
      type: 'transcription',
      content: data.text,
      model: `whisper-large-v3 (${provider})`,
      language: data.language,
      duration: data.duration,
      metadata: {
        segments: data.segments,
        words: data.words,
      },
    };
  }

  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    attempt = 1
  ): Promise<Response> {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(this.config.timeout),
      });

      // Handle rate limits
      if (response.status === 429) {
        if (attempt < this.config.maxRetries) {
          const delay = this.config.retryDelay * Math.pow(2, attempt - 1);
          await new Promise(r => setTimeout(r, delay));
          return this.fetchWithRetry(url, options, attempt + 1);
        }
      }

      return response;
    } catch (error) {
      if (attempt < this.config.maxRetries) {
        const delay = this.config.retryDelay * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, delay));
        return this.fetchWithRetry(url, options, attempt + 1);
      }
      throw error;
    }
  }
}
```

### Image Processor (Description)

```typescript
// packages/core/src/media/processors/image.ts

export class ImageProcessor implements MediaProcessor {
  readonly type = 'description';
  readonly supportedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
  ];

  private readonly descriptionPrompt = `Describe this image in detail for someone who cannot see it.
Include:
- Main subject/content
- People (if any): count, actions, expressions
- Text visible in the image
- Colors, composition, style
- Any notable details

Be concise but comprehensive. Output only the description, no preamble.`;

  async process(media: MediaInput): Promise<ProcessingResult> {
    const providers = this.getProviderOrder();

    for (const provider of providers) {
      try {
        return await this.processWithProvider(media, provider);
      } catch (error) {
        this.logger.warn(`${provider} failed:`, error);
        if (provider === providers[providers.length - 1]) throw error;
      }
    }

    throw new Error('All providers failed');
  }

  private async processWithProvider(
    media: MediaInput,
    provider: ImageProvider
  ): Promise<ProcessingResult> {
    if (provider === 'gemini') {
      return this.processWithGemini(media);
    } else {
      return this.processWithOpenAI(media);
    }
  }

  private async processWithGemini(media: MediaInput): Promise<ProcessingResult> {
    const base64 = media.buffer.toString('base64');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${this.config.geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: this.descriptionPrompt },
              {
                inline_data: {
                  mime_type: media.mimeType,
                  data: base64,
                },
              },
            ],
          }],
          generationConfig: {
            maxOutputTokens: 1024,
            temperature: 0.2,
          },
        }),
      }
    );

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message);
    }

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const tokensUsed = data.usageMetadata?.totalTokenCount;

    return {
      type: 'description',
      content,
      model: 'gemini-1.5-flash',
      tokensUsed,
    };
  }

  private async processWithOpenAI(media: MediaInput): Promise<ProcessingResult> {
    const base64 = media.buffer.toString('base64');
    const dataUrl = `data:${media.mimeType};base64,${base64}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: this.descriptionPrompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        }],
        max_tokens: 1024,
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message);
    }

    return {
      type: 'description',
      content: data.choices[0].message.content,
      model: 'gpt-4o-mini',
      tokensUsed: data.usage?.total_tokens,
    };
  }
}
```

### Video Processor (Description)

```typescript
// packages/core/src/media/processors/video.ts

export class VideoProcessor implements MediaProcessor {
  readonly type = 'description';
  readonly supportedMimeTypes = [
    'video/mp4',
    'video/quicktime',
    'video/x-msvideo',
    'video/webm',
  ];

  private readonly descriptionPrompt = `Analyze this video and describe:
1. Main action/content
2. People involved (if any)
3. Key scenes or moments
4. Any text or speech visible/audible
5. Duration and pacing

Be concise but capture the essential content.`;

  async process(media: MediaInput): Promise<ProcessingResult> {
    // Video processing requires Gemini (supports video natively)
    if (!this.config.geminiApiKey) {
      throw new Error('Gemini API key required for video processing');
    }

    const base64 = media.buffer.toString('base64');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${this.config.geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: this.descriptionPrompt },
              {
                inline_data: {
                  mime_type: media.mimeType,
                  data: base64,
                },
              },
            ],
          }],
          generationConfig: {
            maxOutputTokens: 2048,
            temperature: 0.2,
          },
        }),
      }
    );

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message);
    }

    return {
      type: 'description',
      content: data.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
      model: 'gemini-1.5-flash',
      tokensUsed: data.usageMetadata?.totalTokenCount,
    };
  }
}
```

### Document Processor (Extraction)

```typescript
// packages/core/src/media/processors/document.ts

import { PDFDocument } from 'pdf-lib';
import * as mammoth from 'mammoth';

export class DocumentProcessor implements MediaProcessor {
  readonly type = 'extraction';
  readonly supportedMimeTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
  ];

  async process(media: MediaInput): Promise<ProcessingResult> {
    switch (media.mimeType) {
      case 'application/pdf':
        return this.processPdf(media);
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return this.processDocx(media);
      case 'text/plain':
        return this.processText(media);
      default:
        throw new Error(`Unsupported document type: ${media.mimeType}`);
    }
  }

  private async processPdf(media: MediaInput): Promise<ProcessingResult> {
    try {
      // First try text extraction with pdf-lib
      const text = await this.extractPdfText(media.buffer);

      if (text.trim().length > 100) {
        return {
          type: 'extraction',
          content: text,
          model: 'pdf-lib',
        };
      }

      // If little text, it's probably a scanned PDF - use Gemini OCR
      return this.processPdfWithGemini(media);
    } catch (error) {
      // Fallback to Gemini
      return this.processPdfWithGemini(media);
    }
  }

  private async extractPdfText(buffer: Buffer): Promise<string> {
    // Using pdf-parse or similar library
    const pdf = await import('pdf-parse');
    const data = await pdf.default(buffer);
    return data.text;
  }

  private async processPdfWithGemini(media: MediaInput): Promise<ProcessingResult> {
    if (!this.config.geminiApiKey) {
      throw new Error('Gemini API key required for scanned PDF processing');
    }

    const base64 = media.buffer.toString('base64');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${this.config.geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                text: 'Extract all text from this document. Output only the extracted text, maintaining the original structure as much as possible.',
              },
              {
                inline_data: {
                  mime_type: 'application/pdf',
                  data: base64,
                },
              },
            ],
          }],
          generationConfig: {
            maxOutputTokens: 8192,
            temperature: 0,
          },
        }),
      }
    );

    const data = await response.json();

    return {
      type: 'extraction',
      content: data.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
      model: 'gemini-1.5-flash (OCR)',
      tokensUsed: data.usageMetadata?.totalTokenCount,
    };
  }

  private async processDocx(media: MediaInput): Promise<ProcessingResult> {
    const result = await mammoth.extractRawText({ buffer: media.buffer });

    return {
      type: 'extraction',
      content: result.value,
      model: 'mammoth',
    };
  }

  private async processText(media: MediaInput): Promise<ProcessingResult> {
    return {
      type: 'extraction',
      content: media.buffer.toString('utf-8'),
      model: 'raw',
    };
  }
}
```

## Event Flow

```typescript
// 1. Channel plugin emits media.received
await eventBus.publish({
  type: 'media.received',
  payload: {
    messageId: 'msg-123',
    mediaId: 'media-456',
    type: 'audio',
    mimeType: 'audio/ogg',
    size: 45000,
    duration: 15,
  },
});

// 2. Media pipeline processes
// (automatic via event subscription)

// 3. Pipeline emits media.processed
{
  type: 'media.processed',
  payload: {
    messageId: 'msg-123',
    mediaId: 'media-456',
    result: {
      type: 'transcription',
      content: 'Hey, can we meet tomorrow at 2pm?',
      model: 'whisper-large-v3 (groq)',
      language: 'en',
      duration: 15,
    },
    processingTimeMs: 2340,
  },
}

// 4. Message router enriches message with transcription
// and sends to agent
```

## Batch Reprocessing

Reprocess media from historical messages:

```typescript
// API endpoint
POST /api/v1/media/reprocess

// Request body
{
  "instanceId": "my-instance",       // Optional: filter by instance
  "since": "2025-01-01T00:00:00Z",   // Optional: start date
  "until": "2025-01-31T23:59:59Z",   // Optional: end date
  "types": ["audio", "image"],       // Optional: media types to process
  "overwrite": false                 // Reprocess even if already processed
}

// Response
{
  "jobId": "job-789",
  "status": "running",
  "total": 150,
  "processed": 0
}
```

Monitor batch job progress:

```typescript
GET /api/v1/media/reprocess/job-789

{
  "jobId": "job-789",
  "status": "running",
  "total": 150,
  "processed": 87,
  "succeeded": 85,
  "failed": 2,
  "errors": [
    { "mediaId": "xxx", "error": "File too large" },
    { "mediaId": "yyy", "error": "Unsupported format" }
  ]
}
```

## UI Components

The settings UI shows media provider configuration:

```
┌─────────────────────────────────────────────────────────────┐
│  Media Processing Settings                                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Audio Transcription                                         │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Groq API Key          [gsk_...•••••••]  ✓ Configured   ││
│  │ OpenAI API Key        [sk-...•••••••]   ✓ Configured   ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  Image/Video Description                                     │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Gemini API Key        [AIza...•••••••]  ✓ Configured   ││
│  │ OpenAI API Key        [sk-...•••••••]   ✓ Configured   ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  Provider Priority                                           │
│  Audio:  1. Groq (fast) → 2. OpenAI (fallback)              │
│  Images: 1. Gemini → 2. OpenAI                              │
│  Video:  1. Gemini (only option)                            │
│  Docs:   1. Native → 2. Gemini (OCR)                        │
│                                                              │
│  [Save Settings]                                             │
└─────────────────────────────────────────────────────────────┘
```

Batch jobs UI:

```
┌─────────────────────────────────────────────────────────────┐
│  Batch Media Reprocessing                                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Media Types:                                                │
│  [✓] 🔊 Audio    [✓] 🖼️ Image    [✓] 🎬 Video    [ ] 📄 Doc │
│                                                              │
│  Date Range:                                                 │
│  From: [2025-01-01]  To: [2025-01-31]                       │
│                                                              │
│  Instance: [All Instances        ▼]                         │
│                                                              │
│  [ ] Overwrite existing results                             │
│                                                              │
│  [Start Reprocessing]                                        │
│                                                              │
│  ─────────────────────────────────────────────────────────  │
│                                                              │
│  Recent Jobs:                                                │
│  ┌────────┬──────────┬─────────┬──────────┬───────────────┐│
│  │ Job ID │ Status   │ Total   │ Progress │ Started       ││
│  ├────────┼──────────┼─────────┼──────────┼───────────────┤│
│  │ job-1  │ ✓ Done   │ 150     │ 150/150  │ 2h ago        ││
│  │ job-2  │ ⟳ Running│ 89      │ 45/89    │ 10m ago       ││
│  └────────┴──────────┴─────────┴──────────┴───────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## Cost Tracking

Track media processing costs:

```typescript
// Stored with each processing result
{
  messageId: 'msg-123',
  mediaId: 'media-456',
  result: {
    type: 'transcription',
    content: '...',
    model: 'whisper-large-v3 (groq)',
    cost: {
      provider: 'groq',
      model: 'whisper-large-v3',
      inputTokens: 0,
      outputTokens: 0,
      audioDurationSeconds: 15,
      estimatedCostUsd: 0.001,  // $0.06/hour for Groq
    },
  },
}
```

Dashboard shows costs:

```
┌─────────────────────────────────────────────────────────────┐
│  Media Processing Costs (January 2025)                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Audio Transcription       $12.34  (205 hours processed)    │
│  Image Description         $5.67   (1,234 images)           │
│  Video Description         $8.90   (45 videos)              │
│  Document Extraction       $2.10   (89 documents)           │
│  ─────────────────────────────────────────────────────────  │
│  Total                     $29.01                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```
