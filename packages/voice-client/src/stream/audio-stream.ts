import type { AudioCodec } from '../interfaces/codec';

export class AudioStream {
  readonly userId: string;
  readonly ssrc: number;

  private codec: AudioCodec | null = null;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private currentStream: ReadableStream<Uint8Array> | null = null;

  constructor(userId: string, ssrc: number, codec?: AudioCodec) {
    this.userId = userId;
    this.ssrc = ssrc;
    this.codec = codec ?? null;
  }

  subscribe(format: 'opus' | 'pcm'): ReadableStream<Uint8Array> {
    if (this.currentStream) {
      this.unsubscribe();
    }

    this.currentStream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
      cancel: () => {
        this.controller = null;
        this.currentStream = null;
      },
    });

    if (format === 'pcm' && !this.codec) {
      throw new Error('AudioCodec required for PCM format');
    }

    return this.currentStream;
  }

  unsubscribe(): void {
    if (this.controller) {
      this.controller.close();
      this.controller = null;
    }
    this.currentStream = null;
  }

  /** Push an opus packet into the stream. Decodes to PCM if subscriber requested it. */
  push(opusPacket: Uint8Array, format: 'opus' | 'pcm'): void {
    if (!this.controller) return;

    if (format === 'pcm' && this.codec) {
      const pcm = this.codec.decode(opusPacket);
      this.controller.enqueue(new Uint8Array(pcm.buffer));
    } else {
      this.controller.enqueue(opusPacket);
    }
  }
}
