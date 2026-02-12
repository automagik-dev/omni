/**
 * Streaming types for progressive message rendering
 *
 * Used by channels that support editing messages (e.g., Telegram, Discord)
 * to render agent responses progressively as they stream in.
 */

import type { StreamDelta } from '@omni/core';

/**
 * Channel-specific stream sender for progressive message rendering.
 *
 * Created by ChannelPlugin.createStreamSender() — owns the lifecycle
 * of a single streaming response (create message → edit → finalize).
 *
 * Each method receives the narrowed StreamDelta variant for that phase.
 * All text fields are cumulative (full text so far, not incremental diffs).
 */
export interface StreamSender {
  /** Called on each thinking delta (cumulative thinking text) */
  onThinkingDelta(delta: StreamDelta & { phase: 'thinking' }): Promise<void>;

  /** Called on each content delta (cumulative content, may include collapsed thinking) */
  onContentDelta(delta: StreamDelta & { phase: 'content' }): Promise<void>;

  /** Called once when stream completes — render final clean message */
  onFinal(delta: StreamDelta & { phase: 'final' }): Promise<void>;

  /** Called on stream error — clean up placeholder, optionally show error */
  onError(delta: StreamDelta & { phase: 'error' }): Promise<void>;

  /** Abort mid-stream — clean up any sent messages */
  abort(): Promise<void>;
}
