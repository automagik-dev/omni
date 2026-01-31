/**
 * Payload Storage Utilities
 *
 * Handles compression/decompression of event payloads using gzip.
 * Provides utilities for working with the event_payloads table.
 *
 * @see events-ops wish
 */

import { gunzipSync, gzipSync } from 'node:zlib';

/**
 * Payload stages for storage
 */
export const PAYLOAD_STAGES = ['webhook_raw', 'agent_request', 'agent_response', 'channel_send', 'error'] as const;
export type PayloadStage = (typeof PAYLOAD_STAGES)[number];

/**
 * Content detection result
 */
export interface PayloadContentFlags {
  containsMedia: boolean;
  containsBase64: boolean;
}

/**
 * Compression result
 */
export interface CompressionResult {
  compressed: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
}

/**
 * Compress a payload using gzip and encode as base64
 *
 * @param payload - The payload to compress (will be JSON stringified)
 * @returns Compression result with base64-encoded compressed data
 */
export function compressPayload(payload: unknown): CompressionResult {
  const jsonString = JSON.stringify(payload);
  const originalSize = Buffer.byteLength(jsonString, 'utf8');

  const compressed = gzipSync(jsonString);
  const base64 = compressed.toString('base64');
  const compressedSize = compressed.length;

  return {
    compressed: base64,
    originalSize,
    compressedSize,
    compressionRatio: originalSize / compressedSize,
  };
}

/**
 * Decompress a base64-encoded gzipped payload
 *
 * @param compressedBase64 - Base64-encoded gzipped data
 * @returns Decompressed and parsed payload
 */
export function decompressPayload<T = unknown>(compressedBase64: string): T {
  const buffer = Buffer.from(compressedBase64, 'base64');
  const decompressed = gunzipSync(buffer);
  const jsonString = decompressed.toString('utf8');

  return JSON.parse(jsonString) as T;
}

/**
 * Detect content flags in a payload
 *
 * @param payload - The payload to analyze
 * @returns Content flags indicating if media or base64 data is present
 */
export function detectContentFlags(payload: unknown): PayloadContentFlags {
  const jsonString = JSON.stringify(payload);

  // Check for common media URL patterns
  const mediaPatterns = [
    /https?:\/\/[^\s"']+\.(jpg|jpeg|png|gif|webp|mp4|mp3|wav|ogg|pdf|doc|docx)/i,
    /"mimeType"\s*:\s*"(image|video|audio|application)/i,
    /"mediaUrl"\s*:/i,
    /"mediaId"\s*:/i,
    /"fileName"\s*:/i,
  ];
  const containsMedia = mediaPatterns.some((pattern) => pattern.test(jsonString));

  // Check for base64 data (looking for long base64-like strings)
  // Base64 pattern: at least 100 chars of valid base64 characters
  const base64Pattern = /["']\s*[A-Za-z0-9+/]{100,}={0,2}\s*["']/;
  const dataUrlPattern = /data:[^;]+;base64,/;
  const containsBase64 = base64Pattern.test(jsonString) || dataUrlPattern.test(jsonString);

  return { containsMedia, containsBase64 };
}

/**
 * Default retention days by stage
 */
export const DEFAULT_RETENTION_DAYS: Record<PayloadStage, number> = {
  webhook_raw: 14,
  agent_request: 14,
  agent_response: 14,
  channel_send: 14,
  error: 30, // Keep errors longer for debugging
};

/**
 * Storage config for determining what to store
 */
export interface PayloadStorageConfig {
  storeWebhookRaw: boolean;
  storeAgentRequest: boolean;
  storeAgentResponse: boolean;
  storeChannelSend: boolean;
  storeError: boolean;
  retentionDays: number;
}

/**
 * Default storage config (store everything)
 */
export const DEFAULT_STORAGE_CONFIG: PayloadStorageConfig = {
  storeWebhookRaw: true,
  storeAgentRequest: true,
  storeAgentResponse: true,
  storeChannelSend: true,
  storeError: true,
  retentionDays: 14,
};

/**
 * Check if a stage should be stored based on config
 */
export function shouldStoreStage(stage: PayloadStage, config: PayloadStorageConfig): boolean {
  switch (stage) {
    case 'webhook_raw':
      return config.storeWebhookRaw;
    case 'agent_request':
      return config.storeAgentRequest;
    case 'agent_response':
      return config.storeAgentResponse;
    case 'channel_send':
      return config.storeChannelSend;
    case 'error':
      return config.storeError;
    default:
      return false;
  }
}

/**
 * Prepare data for inserting a payload
 */
export function preparePayloadInsert(options: {
  eventId: string;
  eventType: string;
  stage: PayloadStage;
  payload: unknown;
}): {
  eventId: string;
  eventType: string;
  stage: PayloadStage;
  payloadCompressed: string;
  payloadSizeOriginal: number;
  payloadSizeCompressed: number;
  containsMedia: boolean;
  containsBase64: boolean;
} {
  const { eventId, eventType, stage, payload } = options;
  const { compressed, originalSize, compressedSize } = compressPayload(payload);
  const { containsMedia, containsBase64 } = detectContentFlags(payload);

  return {
    eventId,
    eventType,
    stage,
    payloadCompressed: compressed,
    payloadSizeOriginal: originalSize,
    payloadSizeCompressed: compressedSize,
    containsMedia,
    containsBase64,
  };
}

/**
 * Payload entry structure (matches database schema)
 */
export interface PayloadEntry {
  id: string;
  eventId: string;
  eventType: string;
  stage: PayloadStage;
  payloadCompressed: string;
  payloadSizeOriginal: number | null;
  payloadSizeCompressed: number | null;
  timestamp: Date;
  containsMedia: boolean;
  containsBase64: boolean;
  deletedAt: Date | null;
  deletedBy: string | null;
  deleteReason: string | null;
}

/**
 * Get payload with decompression
 */
export function getDecompressedPayload<T = unknown>(entry: Pick<PayloadEntry, 'payloadCompressed'>): T {
  return decompressPayload<T>(entry.payloadCompressed);
}
