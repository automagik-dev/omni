/**
 * NATS JetStream stream definitions
 *
 * Streams organize events by domain and define retention policies.
 * Each stream captures a specific category of events.
 */

import { type JetStreamManager, RetentionPolicy, StorageType, type StreamConfig } from 'nats';
import { createLogger } from '../../logger';

const log = createLogger('nats:streams');

/**
 * Stream names (uppercase by convention)
 */
export const STREAM_NAMES = {
  MESSAGE: 'MESSAGE',
  INSTANCE: 'INSTANCE',
  IDENTITY: 'IDENTITY',
  MEDIA: 'MEDIA',
  ACCESS: 'ACCESS',
  CUSTOM: 'CUSTOM',
  SYSTEM: 'SYSTEM',
} as const;

export type StreamName = (typeof STREAM_NAMES)[keyof typeof STREAM_NAMES];

/**
 * Days to nanoseconds conversion for NATS retention
 */
const daysToNs = (days: number): number => days * 24 * 60 * 60 * 1_000_000_000;

/**
 * Stream configuration definitions
 */
export const STREAM_CONFIGS: Record<StreamName, Partial<StreamConfig>> = {
  [STREAM_NAMES.MESSAGE]: {
    name: STREAM_NAMES.MESSAGE,
    subjects: ['message.>'],
    max_age: daysToNs(30),
    storage: StorageType.File,
    retention: RetentionPolicy.Limits,
    description: 'All message lifecycle events (received, sent, delivered, read, failed)',
  },
  [STREAM_NAMES.INSTANCE]: {
    name: STREAM_NAMES.INSTANCE,
    subjects: ['instance.>'],
    max_age: daysToNs(7),
    storage: StorageType.File,
    retention: RetentionPolicy.Limits,
    description: 'Instance lifecycle events (connected, disconnected, qr_code)',
  },
  [STREAM_NAMES.IDENTITY]: {
    name: STREAM_NAMES.IDENTITY,
    subjects: ['identity.>'],
    max_age: daysToNs(90),
    storage: StorageType.File,
    retention: RetentionPolicy.Limits,
    description: 'Identity management events (created, linked, merged, unlinked)',
  },
  [STREAM_NAMES.MEDIA]: {
    name: STREAM_NAMES.MEDIA,
    subjects: ['media.>'],
    max_age: daysToNs(7),
    storage: StorageType.File,
    retention: RetentionPolicy.Limits,
    description: 'Media processing events (received, processed)',
  },
  [STREAM_NAMES.ACCESS]: {
    name: STREAM_NAMES.ACCESS,
    subjects: ['access.>'],
    max_age: daysToNs(30),
    storage: StorageType.File,
    retention: RetentionPolicy.Limits,
    description: 'Access control events (allowed, denied)',
  },
  [STREAM_NAMES.CUSTOM]: {
    name: STREAM_NAMES.CUSTOM,
    subjects: ['custom.>'],
    max_age: daysToNs(7),
    storage: StorageType.File,
    retention: RetentionPolicy.Limits,
    description: 'User-defined custom events (webhooks, triggers, etc.)',
  },
  [STREAM_NAMES.SYSTEM]: {
    name: STREAM_NAMES.SYSTEM,
    subjects: ['system.>'],
    max_age: daysToNs(7),
    storage: StorageType.File,
    retention: RetentionPolicy.Limits,
    description: 'Internal system events (dead_letter, replay, health)',
  },
};

/**
 * Map event type prefix to stream name
 */
export function getStreamForEventType(eventType: string): StreamName {
  const prefix = eventType.split('.')[0] ?? '';

  const prefixToStream: Record<string, StreamName> = {
    message: STREAM_NAMES.MESSAGE,
    instance: STREAM_NAMES.INSTANCE,
    identity: STREAM_NAMES.IDENTITY,
    media: STREAM_NAMES.MEDIA,
    access: STREAM_NAMES.ACCESS,
    custom: STREAM_NAMES.CUSTOM,
    system: STREAM_NAMES.SYSTEM,
  };

  return prefixToStream[prefix] ?? STREAM_NAMES.CUSTOM;
}

/**
 * Ensure all streams exist, creating or updating as needed
 */
export async function ensureStreams(jsm: JetStreamManager): Promise<void> {
  const streams = Object.values(STREAM_CONFIGS);

  for (const config of streams) {
    await ensureStream(jsm, config);
  }
}

/**
 * Ensure a single stream exists
 */
async function ensureStream(jsm: JetStreamManager, config: Partial<StreamConfig>): Promise<void> {
  const streamName = config.name;
  if (!streamName) {
    throw new Error('Stream config must have a name');
  }

  try {
    // Try to get existing stream info
    const info = await jsm.streams.info(streamName);

    // Update if subjects changed
    const existingSubjects = info.config.subjects ?? [];
    const newSubjects = config.subjects ?? [];

    if (JSON.stringify(existingSubjects.sort()) !== JSON.stringify(newSubjects.sort())) {
      await jsm.streams.update(streamName, config);
      log.debug('Updated stream', { stream: streamName });
    }
  } catch (error) {
    // Stream doesn't exist, create it
    if (isStreamNotFoundError(error)) {
      await jsm.streams.add(config);
      log.debug('Created stream', { stream: streamName });
    } else {
      throw error;
    }
  }
}

/**
 * Check if error is a stream not found error
 */
function isStreamNotFoundError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes('stream not found');
  }
  return false;
}

/**
 * Get stream info for all streams
 */
export async function getStreamInfo(
  jsm: JetStreamManager,
): Promise<Map<StreamName, { messages: number; bytes: number }>> {
  const result = new Map<StreamName, { messages: number; bytes: number }>();

  for (const name of Object.values(STREAM_NAMES)) {
    try {
      const info = await jsm.streams.info(name);
      result.set(name, {
        messages: info.state.messages,
        bytes: info.state.bytes,
      });
    } catch {
      // Stream doesn't exist yet
      result.set(name, { messages: 0, bytes: 0 });
    }
  }

  return result;
}
