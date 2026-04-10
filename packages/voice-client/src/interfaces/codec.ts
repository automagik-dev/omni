export interface AudioCodec {
  encode(pcm: Int16Array): Uint8Array;
  decode(encoded: Uint8Array): Int16Array;
  readonly sampleRate: number;
  readonly channels: number;
  readonly frameSize: number;
}
