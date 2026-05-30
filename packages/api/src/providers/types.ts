/**
 * Provider interfaces for multimodal capabilities.
 *
 * Each interface defines a single capability (TTS, STT, image gen, video gen, vision).
 * Providers implement one or more interfaces and register with the provider registry.
 * Verb commands (speak, listen, imagine, film, see) resolve the active provider
 * through the registry and call the interface method.
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
  /** Voice identifier (provider-specific) */
  voice?: string;
  /** Language code (BCP-47, e.g. "en-US", "pt-BR") */
  language?: string;
  /** Speaking speed multiplier (0.5 - 2.0, default 1.0) */
  speed?: number;
  /** Output audio format */
  format?: AudioFormat;
}

export interface TtsResult {
  /** Audio buffer */
  audio: Buffer;
  /** MIME type of the audio (e.g. "audio/ogg; codecs=opus") */
  mimeType: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Size in bytes */
  sizeBytes: number;
}

export interface ITtsProvider {
  readonly name: string;
  /** Synthesize text to speech */
  synthesize(text: string, options?: TtsOptions): Promise<TtsResult>;
  /** List available voices */
  listVoices?(): Promise<TtsVoice[]>;
}

// ---------------------------------------------------------------------------
// STT — Speech-to-Text
// ---------------------------------------------------------------------------

export interface SttOptions {
  /** Language hint (BCP-47) */
  language?: string;
  /** Return word-level timestamps */
  timestamps?: boolean;
  /** Model variant (provider-specific, e.g. "gpt-audio-mini") */
  model?: string;
  /** Provider-specific transcription instruction/prompt */
  prompt?: string;
  /** Domain context used for acoustic disambiguation */
  context?: string;
  /** Likely names, acronyms, product names, and phrases */
  glossary?: string[];
}

export interface SttSegment {
  text: string;
  startMs?: number;
  endMs?: number;
}

export interface SttResult {
  /** Full transcription text */
  text: string;
  /** Per-segment breakdown (if timestamps requested) */
  segments?: SttSegment[];
  /** Detected language */
  detectedLanguage?: string;
  /** Processing duration in milliseconds */
  processingMs: number;
}

export interface ISttProvider {
  readonly name: string;
  /** Transcribe audio to text */
  transcribe(audio: Buffer, mimeType: string, options?: SttOptions): Promise<SttResult>;
}

// ---------------------------------------------------------------------------
// Image Generation
// ---------------------------------------------------------------------------

export interface ImageGenOptions {
  /** Aspect ratio */
  aspectRatio?: AspectRatio;
  /** Output format */
  format?: ImageFormat;
  /** Number of images to generate (default 1) */
  count?: number;
  /** Negative prompt — what to avoid */
  negativePrompt?: string;
  /** Style preset (provider-specific) */
  style?: string;
  /** Seed for reproducibility */
  seed?: number;
}

export interface GeneratedImage {
  /** Image data */
  data: Buffer;
  /** MIME type */
  mimeType: string;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Seed used (for reproducibility) */
  seed?: number;
}

export interface ImageGenResult {
  images: GeneratedImage[];
  /** Processing duration in milliseconds */
  processingMs: number;
}

export interface IImageGenProvider {
  readonly name: string;
  /** Generate image(s) from a text prompt */
  generate(prompt: string, options?: ImageGenOptions): Promise<ImageGenResult>;
}

// ---------------------------------------------------------------------------
// Video Generation
// ---------------------------------------------------------------------------

export interface VideoGenOptions {
  /** Aspect ratio */
  aspectRatio?: AspectRatio;
  /** Duration in seconds (provider-dependent max) */
  durationSec?: number;
  /** Seed for reproducibility */
  seed?: number;
  /** Whether to generate with audio */
  audio?: boolean;
  /** Resolution hint (provider-specific, e.g. "720p", "1080p") */
  resolution?: string;
}

export interface GeneratedVideo {
  /** Video data */
  data: Buffer;
  /** MIME type (e.g. "video/mp4") */
  mimeType: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Width in pixels */
  width?: number;
  /** Height in pixels */
  height?: number;
}

/** Video generation is async — submit returns an operation, poll until complete */
export interface VideoGenOperation {
  /** Operation ID for polling */
  operationId: string;
  /** Current state */
  state: 'pending' | 'processing' | 'complete' | 'failed';
  /** Result when state is 'complete' */
  video?: GeneratedVideo;
  /** Error message when state is 'failed' */
  error?: string;
}

export interface IVideoGenProvider {
  readonly name: string;
  /** Submit a video generation request (async) */
  submit(prompt: string, options?: VideoGenOptions): Promise<VideoGenOperation>;
  /** Poll for operation status */
  poll(operationId: string): Promise<VideoGenOperation>;
}

// ---------------------------------------------------------------------------
// Vision — Image/Video Understanding
// ---------------------------------------------------------------------------

export interface VisionOptions {
  /** Custom prompt for description */
  prompt?: string;
  /** Language for the response */
  language?: string;
  /** Max output tokens */
  maxTokens?: number;
}

export interface VisionResult {
  /** Text description */
  text: string;
  /** Processing duration in milliseconds */
  processingMs: number;
}

export interface IVisionProvider {
  readonly name: string;
  /** Describe an image or video */
  describe(media: Buffer, mimeType: string, options?: VisionOptions): Promise<VisionResult>;
}

// ---------------------------------------------------------------------------
// Provider capability type union
// ---------------------------------------------------------------------------

/** All provider capability types */
export type ProviderCapability = 'tts' | 'stt' | 'imagegen' | 'videogen' | 'vision';

/** Map capability names to their provider interfaces */
export interface ProviderInterfaceMap {
  tts: ITtsProvider;
  stt: ISttProvider;
  imagegen: IImageGenProvider;
  videogen: IVideoGenProvider;
  vision: IVisionProvider;
}
