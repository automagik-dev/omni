/**
 * ElevenLabs TTS Provider Adapter
 *
 * Wraps the existing `TTSService` (services/tts.ts) to implement the
 * unified `ITtsProvider` interface. All heavy lifting — API call, ffmpeg
 * conversion, voice caching — stays in `TTSService`. This file only
 * adapts the shape so the provider registry can treat ElevenLabs the same
 * way as any other TTS provider.
 */

import type { TTSVoice as InternalTtsVoice, TTSService } from '../../services/tts';
import type { ITtsProvider, TtsOptions, TtsResult, TtsVoice } from '../types';

export class ElevenLabsTtsProvider implements ITtsProvider {
  readonly name = 'elevenlabs';

  constructor(private service: TTSService) {}

  async synthesize(text: string, options?: TtsOptions): Promise<TtsResult> {
    if (!text || text.trim().length === 0) {
      throw new Error('ElevenLabs TTS: text must not be empty');
    }

    const result = await this.service.synthesize(text, {
      voiceId: options?.voice,
    });

    return {
      audio: result.buffer,
      mimeType: result.mimeType,
      durationMs: result.durationMs,
      sizeBytes: result.buffer.length,
    };
  }

  async listVoices(): Promise<TtsVoice[]> {
    const voices = await this.service.listVoices();
    return voices.map((v: InternalTtsVoice) => mapVoice(v));
  }
}

function mapVoice(v: InternalTtsVoice): TtsVoice {
  const genderLabel = v.labels?.gender?.toLowerCase();
  const gender =
    genderLabel === 'male' || genderLabel === 'female' || genderLabel === 'neutral' ? genderLabel : undefined;
  return {
    id: v.voiceId,
    name: v.name,
    language: v.labels?.language,
    gender,
    provider: 'elevenlabs',
  };
}
