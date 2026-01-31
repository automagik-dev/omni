/**
 * Replay options for filtering and controlling replay
 */
export interface ReplayOptions {
  /** Start timestamp (inclusive) */
  since: Date;
  /** End timestamp (exclusive) */
  until?: Date;
  /** Event type filter */
  eventTypes?: string[];
  /** Instance ID filter */
  instanceId?: string;
  /** Maximum events to replay */
  limit?: number;
  /** Replay speed multiplier (1 = real-time, 0 = instant) */
  speedMultiplier?: number;
  /** Whether to skip already-processed events */
  skipProcessed?: boolean;
  /** Dry-run mode: don't actually publish events, just count them */
  dryRun?: boolean;
}

/**
 * Replay progress information
 */
export interface ReplayProgress {
  total: number;
  processed: number;
  skipped: number;
  errors: number;
  startedAt: Date;
  currentEventTime?: Date;
  estimatedCompletionAt?: Date;
}

/**
 * Replay result
 */
export interface ReplayResult {
  success: boolean;
  eventsProcessed: number;
  eventsSkipped: number;
  errors: number;
  durationMs: number;
  errorDetails?: Array<{
    eventId: string;
    error: string;
  }>;
}

/**
 * Replay status
 */
export type ReplayStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

/**
 * Replay session information
 */
export interface ReplaySession {
  id: string;
  options: ReplayOptions;
  status: ReplayStatus;
  progress: ReplayProgress;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  /** True if this is a dry-run (no events published) */
  dryRun: boolean;
}

/**
 * System event payload for replay started
 */
export interface ReplayStartedPayload {
  sessionId: string;
  since: number;
  until?: number;
  eventTypes?: string[];
  instanceId?: string;
  limit?: number;
  timestamp: number;
}

/**
 * System event payload for replay completed
 */
export interface ReplayCompletedPayload {
  sessionId: string;
  eventsProcessed: number;
  eventsSkipped: number;
  errors: number;
  durationMs: number;
  timestamp: number;
}

/**
 * Create a replay started system event payload
 */
export function createReplayStartedPayload(sessionId: string, options: ReplayOptions): ReplayStartedPayload {
  return {
    sessionId,
    since: options.since.getTime(),
    until: options.until?.getTime(),
    eventTypes: options.eventTypes,
    instanceId: options.instanceId,
    limit: options.limit,
    timestamp: Date.now(),
  };
}

/**
 * Create a replay completed system event payload
 */
export function createReplayCompletedPayload(sessionId: string, result: ReplayResult): ReplayCompletedPayload {
  return {
    sessionId,
    eventsProcessed: result.eventsProcessed,
    eventsSkipped: result.eventsSkipped,
    errors: result.errors,
    durationMs: result.durationMs,
    timestamp: Date.now(),
  };
}

/**
 * Validate replay options
 */
export function validateReplayOptions(options: ReplayOptions): { valid: boolean; error?: string } {
  if (!options.since) {
    return { valid: false, error: 'since is required' };
  }

  if (options.until && options.until <= options.since) {
    return { valid: false, error: 'until must be after since' };
  }

  if (options.limit !== undefined && options.limit <= 0) {
    return { valid: false, error: 'limit must be positive' };
  }

  if (options.speedMultiplier !== undefined && options.speedMultiplier < 0) {
    return { valid: false, error: 'speedMultiplier cannot be negative' };
  }

  return { valid: true };
}

/**
 * Calculate estimated completion time based on progress
 */
export function estimateCompletion(progress: ReplayProgress): Date | undefined {
  if (progress.processed === 0) return undefined;

  const elapsed = Date.now() - progress.startedAt.getTime();
  const rate = progress.processed / elapsed; // events per ms

  const remaining = progress.total - progress.processed;
  const estimatedMs = remaining / rate;

  return new Date(Date.now() + estimatedMs);
}
