/**
 * Raw Discord Gateway Event Handler
 *
 * Captures ALL Discord gateway events in their raw JSON form.
 * Enable with DEBUG_PAYLOADS=true to see full raw Discord payloads.
 *
 * This is the centralized entry point for raw payload logging.
 * Unlike the serialized handlers, this captures the ACTUAL JSON
 * that Discord sends before discord.js processes it.
 */

import { createLogger } from '@omni/core';
import type { Client } from 'discord.js';

const log = createLogger('discord:raw');

const DEBUG_PAYLOADS = process.env.DEBUG_PAYLOADS === 'true';

/**
 * Raw gateway packet structure
 */
interface RawPacket {
  /** Gateway opcode */
  op: number;
  /** Event type (for dispatch events) */
  t?: string;
  /** Sequence number */
  s?: number;
  /** Event data */
  d?: unknown;
}

/**
 * Set up raw event handler for capturing all Discord gateway events
 *
 * This captures events in their original JSON form, before discord.js
 * transforms them into class instances. This is useful for:
 * - Creating test fixtures
 * - Debugging unexpected behavior
 * - Understanding Discord's raw payloads
 *
 * @param client - Discord.js Client instance
 * @param instanceId - Instance identifier
 */
export function setupRawEventHandler(client: Client, instanceId: string): void {
  if (!DEBUG_PAYLOADS) {
    return;
  }

  log.info('DEBUG_PAYLOADS enabled - capturing all raw Discord gateway events', { instanceId });

  // The 'raw' event gives us every gateway packet
  client.on('raw', (packet: RawPacket) => {
    // Only log dispatch events (op: 0) which contain actual events
    if (packet.op !== 0 || !packet.t) {
      return;
    }

    // Log the raw event with full payload
    log.debug(`[RAW] ${packet.t}`, {
      instanceId,
      event: packet.t,
      sequence: packet.s,
      payload: packet.d,
    });
  });
}
