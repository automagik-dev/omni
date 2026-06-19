/**
 * Provider interfaces for multimodal capabilities.
 *
 * Each interface defines a single capability (TTS, STT, image gen, video gen,
 * music gen, vision). Providers implement one or more interfaces and register
 * with the provider registry.
 */

// ---------------------------------------------------------------------------
// Common types
// ---------------------------------------------------------------------------

/** Audio format for TTS output or STT input */
export type AudioFormat = 'mp3' | 'ogg' | 'opus' | 'wav' | 'pcm' | 'flac' | 'aac';

/** Image format for generated images */
export type ImageFormat = 'png' | 'jpeg' | 'webp';

/** Aspect ratio presets for image/video generation */
export type AspectRatio = '1:1' | '4:3' | '3:4' | '16:9' | '9:16' | '3:2' | '2:3';

// ---------------------------------------------------------------------------
// TTS — Text-to-Speech
// ---------------------------------------------------------------------------

export interface TtsVoice {
  id: string;
  name: string;
  language?: string;
  gender?: 'male' | 'female' | 'neutral';
  provider: string;
}

export interface TtsOptions {
  voice?: string;
  language?: string;
  speed?: number;
  format?: AudioFormat;
  model?: string;
  instructions?: string;
  style?: string;
  tone?: string;
  accent?: string;
  pace?: string;
  emotion?: string;
  voiceNoteProfile?: string;
  multiSpeaker?: Array<{ speaker: string; voice: string }>;
}

export interface TtsResult {
  audio: Buffer;
  mimeType: string;
  durationMs: number;
  sizeBytes: number;
}

export interface ITtsProvider {
  readonly name: string;
  synthesize(text: string, options?: TtsOptions): Promise<TtsResult>;
  listVoices?(): Promise<TtsVoice[]>;
}

// ---------------------------------------------------------------------------
// STT — Speech-to-Text
// ---------------------------------------------------------------------------

export interface SttOptions {
  language?: string;
  timestamps?: boolean;
  model?: string;
  prompt?: string;
  context?: string;
  glossary?: string[];
}

export interface SttSegment {
  text: string;
  startMs?: number;
  endMs?: number;
}

export interface SttResult {
  text: string;
  segments?: SttSegment[];
  detectedLanguage?: string;
  processingMs: number;
}

export interface ISttProvider {
  readonly name: string;
  transcribe(audio: Buffer, mimeType: string, options?: SttOptions): Promise<SttResult>;
}

// ---------------------------------------------------------------------------
// Image Generation
// ---------------------------------------------------------------------------

export interface ImageGenOptions {
  aspectRatio?: AspectRatio;
  format?: ImageFormat;
  count?: number;
  negativePrompt?: string;
  style?: string;
  seed?: number;
  model?: string;
  imageSize?: string;
  quality?: string;
  background?: string;
  outputFormat?: ImageFormat;
  compression?: number;
}

export interface GeneratedImage {
  data: Buffer;
  mimeType: string;
  width: number;
  height: number;
  seed?: number;
}

export interface ImageGenResult {
  images: GeneratedImage[];
  processingMs: number;
}

export interface IImageGenProvider {
  readonly name: string;
  generate(prompt: string, options?: ImageGenOptions): Promise<ImageGenResult>;
}

// ---------------------------------------------------------------------------
// Video Generation
// ---------------------------------------------------------------------------

export interface VideoGenOptions {
  aspectRatio?: AspectRatio;
  durationSec?: number;
  seed?: number;
  audio?: boolean;
  resolution?: string;
  imageBase64?: string;
  imageMimeType?: string;
  dialogue?: string;
  camera?: string;
  shotList?: string[];
  audioDirection?: string;
  music?: string;
  style?: string;
}

export interface GeneratedVideo {
  data: Buffer;
  mimeType: string;
  durationMs: number;
  width?: number;
  height?: number;
}

export interface VideoGenOperation {
  operationId: string;
  state: 'pending' | 'processing' | 'complete' | 'failed';
  video?: GeneratedVideo;
  error?: string;
}

export interface IVideoGenProvider {
  readonly name: string;
  submit(prompt: string, options?: VideoGenOptions): Promise<VideoGenOperation>;
  poll(operationId: string): Promise<VideoGenOperation>;
}

// ---------------------------------------------------------------------------
// Music Generation
// ---------------------------------------------------------------------------

export interface MusicGenOptions {
  model?: string;
  mode?: 'clip' | 'pro';
  durationSec?: number;
  instrumental?: boolean;
  lyrics?: string;
  timedSections?: Array<{ start: string; end: string; instruction: string }>;
  genre?: string;
  mood?: string;
  bpm?: number;
  instruments?: string[];
  singerProfile?: string;
  imageBase64?: string;
  imageMimeType?: string;
  style?: string;
}

export interface GeneratedMusic {
  data: Buffer;
  mimeType: string;
  durationMs?: number;
  sizeBytes: number;
}

export interface MusicGenResult {
  audio: GeneratedMusic;
  processingMs: number;
  model: string;
}

export interface IMusicGenProvider {
  readonly name: string;
  generate(prompt: string, options?: MusicGenOptions): Promise<MusicGenResult>;
}

// ---------------------------------------------------------------------------
// Vision — Image/Video Understanding
// ---------------------------------------------------------------------------

export interface VisionOptions {
  prompt?: string;
  language?: string;
  maxTokens?: number;
}

export interface VisionResult {
  text: string;
  processingMs: number;
}

export interface IVisionProvider {
  readonly name: string;
  describe(media: Buffer, mimeType: string, options?: VisionOptions): Promise<VisionResult>;
}

// ---------------------------------------------------------------------------
// Provider capability type union
// ---------------------------------------------------------------------------

export type ProviderCapability = 'tts' | 'stt' | 'imagegen' | 'videogen' | 'vision' | 'musicgen';

export interface ProviderInterfaceMap {
  tts: ITtsProvider;
  stt: ISttProvider;
  imagegen: IImageGenProvider;
  videogen: IVideoGenProvider;
  vision: IVisionProvider;
  musicgen: IMusicGenProvider;
}
