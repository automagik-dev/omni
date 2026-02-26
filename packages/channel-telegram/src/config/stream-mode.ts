/**
 * Per-instance stream mode toggle for Telegram
 *
 * Controls whether the bot uses streaming (progressive edit) mode or
 * sends a single final message.
 *
 * - 'on' (default): Existing streaming behavior — progressive edits with cursor
 * - 'off': Skip edit loop, wait for final response, send as single message
 */

export type StreamMode = 'on' | 'off';

/**
 * Check if streaming is enabled for the given mode setting.
 */
export function isStreamingEnabled(mode: StreamMode | undefined): boolean {
  return (mode ?? 'on') === 'on';
}
