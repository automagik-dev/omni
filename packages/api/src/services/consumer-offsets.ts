/**
 * Consumer Offset Service
 *
 * Tracks NATS sequence numbers per durable consumer for gap detection
 * and consumer lag monitoring.
 */

import { createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { consumerOffsets } from '@omni/db';
import { eq, sql } from 'drizzle-orm';

const log = createLogger('consumer-offsets');

export interface ConsumerLag {
  consumerName: string;
  streamName: string;
  lastSequence: number;
  streamMessages: number;
  lag: number;
  updatedAt: Date;
}

export class ConsumerOffsetService {
  constructor(private db: Database) {}

  /**
   * Get the last processed sequence for a consumer
   */
  async getOffset(consumerName: string): Promise<number> {
    const [row] = await this.db
      .select({ lastSequence: consumerOffsets.lastSequence })
      .from(consumerOffsets)
      .where(eq(consumerOffsets.consumerName, consumerName));
    return row?.lastSequence ?? 0;
  }

  /**
   * Update the offset after successful message processing
   */
  async updateOffset(consumerName: string, streamName: string, sequence: number, eventId?: string): Promise<void> {
    await this.db
      .insert(consumerOffsets)
      .values({
        consumerName,
        streamName,
        lastSequence: sequence,
        lastEventId: eventId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: consumerOffsets.consumerName,
        set: {
          streamName,
          lastSequence: sql`GREATEST(${consumerOffsets.lastSequence}, ${sequence})`,
          lastEventId: eventId,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Get all consumer offsets for health monitoring
   */
  async getAllOffsets(): Promise<
    Array<{
      consumerName: string;
      streamName: string;
      lastSequence: number;
      lastEventId: string | null;
      updatedAt: Date;
    }>
  > {
    return this.db.select().from(consumerOffsets);
  }

  /**
   * Detect gaps between stored offset and stream state.
   * Returns gap info for consumers with unprocessed messages.
   */
  async detectGaps(
    streamInfo: Map<string, { messages: number }>,
  ): Promise<
    Array<{ consumerName: string; streamName: string; lastOffset: number; streamTotal: number; gap: number }>
  > {
    const offsets = await this.getAllOffsets();
    const gaps: Array<{
      consumerName: string;
      streamName: string;
      lastOffset: number;
      streamTotal: number;
      gap: number;
    }> = [];

    for (const offset of offsets) {
      const info = streamInfo.get(offset.streamName);
      if (info && info.messages > offset.lastSequence) {
        const gap = info.messages - offset.lastSequence;
        gaps.push({
          consumerName: offset.consumerName,
          streamName: offset.streamName,
          lastOffset: offset.lastSequence,
          streamTotal: info.messages,
          gap,
        });
        log.warn('Consumer gap detected', {
          consumer: offset.consumerName,
          stream: offset.streamName,
          lastOffset: offset.lastSequence,
          streamTotal: info.messages,
          gap,
        });
      }
    }

    return gaps;
  }
}
