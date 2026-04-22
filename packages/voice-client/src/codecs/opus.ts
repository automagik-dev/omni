import type { AudioCodec } from '../interfaces/codec';

interface OpusScriptConstructor {
  new (samplingRate: number, channels: number, application: number): OpusScriptInstance;
  Application: { VOIP: number; AUDIO: number; RESTRICTED_LOWDELAY: number };
}

interface OpusScriptInstance {
  encode(buffer: Buffer, frameSize: number): Buffer;
  decode(buffer: Buffer): Buffer;
  delete(): void;
}

// opusscript is a pure JS (WASM) Opus encoder/decoder — no native compilation needed
// eslint-disable-next-line @typescript-eslint/no-var-requires
const OpusScript = require('opusscript') as OpusScriptConstructor;

export class OpusCodec implements AudioCodec {
  readonly sampleRate: number;
  readonly channels: number;
  readonly frameSize = 960;

  private encoder: OpusScriptInstance;

  constructor(sampleRate = 48000, channels = 2) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.encoder = new OpusScript(sampleRate, channels, OpusScript.Application.AUDIO);
  }

  encode(pcm: Int16Array): Uint8Array {
    return this.encoder.encode(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength), this.frameSize);
  }

  decode(encoded: Uint8Array): Int16Array {
    const decoded = this.encoder.decode(Buffer.from(encoded));
    return new Int16Array(decoded.buffer, decoded.byteOffset, decoded.byteLength / 2);
  }
}
