# WISH: Send TTS Endpoint (ElevenLabs)

**Status:** DRAFT
**Beads:** omni-soi
**Priority:** P1

## Context

Omni v1 recently added a TTS (Text-to-Speech) endpoint that converts text to voice notes using ElevenLabs and sends them via WhatsApp. This enables AI agents to "speak" to users with natural-sounding voices.

**V1 Reference Files:**
- `/home/cezar/dev/omni/src/api/routes/messages.py` (lines 440-500) - REST endpoint
- `/home/cezar/dev/omni/src/services/tts_service.py` - TTS service
- `/home/cezar/dev/omni/src/mcp_tools/genie_omni/tools/multimodal.py` - MCP tool

## Problem Statement

V2 has no TTS capability. AI agents cannot send voice messages, limiting the user experience for voice-first interactions.

## Scope

### IN SCOPE

1. **TTS Service**
   - ElevenLabs API integration
   - Text-to-speech conversion
   - Support for audio tags: `[happy]`, `[laughs]`, `[sighs]`, etc.
   - Voice selection (voice_id parameter)
   - Model selection (eleven_v3, etc.)
   - Stability and similarity_boost controls

2. **Audio Conversion**
   - MP3 (ElevenLabs output) → OGG/Opus (WhatsApp format)
   - Proper codec: libopus at 16kHz, mono, 32kbps
   - Duration detection for presence timing

3. **Presence Simulation**
   - Show "recording" presence before sending
   - Duration matches audio length (or custom delay)

4. **REST API Endpoint**
   - `POST /api/v1/instances/:instanceId/send-tts`
   - Request validation with Zod
   - Error handling

5. **Channel Support**
   - WhatsApp: Voice note with PTT flag
   - Discord: Audio file attachment (future)

### OUT OF SCOPE

- Multiple TTS providers (only ElevenLabs)
- Voice cloning
- Real-time streaming TTS
- Cost tracking (ElevenLabs has its own billing)

## Technical Design

### API Endpoint

```typescript
// POST /api/v1/instances/:instanceId/send-tts

// Request
const SendTTSRequestSchema = z.object({
  phone: z.string().optional(), // Phone number or channel ID
  chatId: z.string().optional(), // Alternative to phone
  text: z.string().min(1).max(5000), // Text to convert (supports [happy], [laughs] tags)
  voiceId: z.string().optional(), // ElevenLabs voice ID
  modelId: z.string().default('eleven_v3'),
  stability: z.number().min(0).max(1).default(0.5),
  similarityBoost: z.number().min(0).max(1).default(0.75),
  presenceDelay: z.number().optional(), // Custom recording presence duration in ms
});

// Response
const SendTTSResponseSchema = z.object({
  success: z.boolean(),
  messageId: z.string().optional(),
  status: z.string(),
  audioSizeKb: z.number().optional(),
  durationMs: z.number().optional(),
  error: z.string().optional(),
});
```

### TTS Service

```typescript
// packages/api/src/services/tts.service.ts

export class TTSService {
  private elevenLabsApiKey: string;
  private defaultVoiceId: string;

  async generateAndSend(
    instanceId: string,
    recipient: string,
    text: string,
    options: TTSOptions
  ): Promise<TTSResult> {
    // 1. Generate speech via ElevenLabs
    const mp3Buffer = await this.generateSpeech(text, options);

    // 2. Convert MP3 to OGG/Opus
    const oggBuffer = await this.convertToOgg(mp3Buffer);

    // 3. Get audio duration
    const durationMs = await this.getAudioDuration(oggBuffer);

    // 4. Show "recording" presence
    await this.showRecordingPresence(instanceId, recipient, durationMs);

    // 5. Send voice note
    const result = await this.sendVoiceNote(instanceId, recipient, oggBuffer);

    return {
      success: true,
      messageId: result.messageId,
      audioSizeKb: oggBuffer.length / 1024,
      durationMs,
    };
  }

  private async generateSpeech(text: string, options: TTSOptions): Promise<Buffer> {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${options.voiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.elevenLabsApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: options.modelId,
          voice_settings: {
            stability: options.stability,
            similarity_boost: options.similarityBoost,
          },
        }),
      }
    );
    return Buffer.from(await response.arrayBuffer());
  }

  private async convertToOgg(mp3Buffer: Buffer): Promise<Buffer> {
    // Use ffmpeg or fluent-ffmpeg
    // Target: OGG/Opus, 16kHz, mono, 32kbps
  }
}
```

### Environment Variables

```bash
XI_API_KEY=your_elevenlabs_api_key
XI_VOICE_ID=JBFqnCBsd6RMkjVDRZzb  # Default voice
```

## Implementation Groups

### Group 1: TTS Service
- [ ] Create TTSService class
- [ ] Implement ElevenLabs API integration
- [ ] Implement MP3 → OGG conversion
- [ ] Implement duration detection

### Group 2: Channel Integration
- [ ] Add sendVoiceNote to WhatsApp channel
- [ ] Implement recording presence simulation
- [ ] Handle PTT flag for WhatsApp

### Group 3: API
- [ ] Create send-tts route
- [ ] Add request/response validation
- [ ] Add to OpenAPI spec
- [ ] Generate SDK types

### Group 4: Testing
- [ ] Unit tests for TTS service
- [ ] Integration tests with mock ElevenLabs
- [ ] API endpoint tests

## Success Criteria

- [ ] Text is converted to speech via ElevenLabs
- [ ] Audio is properly converted to WhatsApp format
- [ ] Recording presence is shown before sending
- [ ] Voice notes play correctly on WhatsApp
- [ ] Audio tags ([happy], [laughs]) work

## Dependencies

- `@omni/channel-whatsapp` - Voice note sending
- ffmpeg binary (for audio conversion)

## External Dependencies (NPM)

- `fluent-ffmpeg` - Audio conversion
- `music-metadata` or `get-audio-duration` - Duration detection
