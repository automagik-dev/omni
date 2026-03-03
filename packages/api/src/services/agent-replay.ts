/**
 * Agent Replay Service
 *
 * Auto-replays missed messages when an agent instance reconnects.
 * On connect, checks if replay is enabled for the instance, queries messages
 * received after `lastSeenAt` (capped at 24h), and re-dispatches them through
 * the normal agent handler pipeline via the event bus.
 */

import type { EventBus } from '@omni/core';
import { createLogger, generateCorrelationId } from '@omni/core';
import type { Database } from '@omni/db';
import { chats, instances, messages } from '@omni/db';
import { and, asc, eq, gt, lte, or, sql } from 'drizzle-orm';

const log = createLogger('agent-replay');

/** Maximum look-back window for replay (24 hours) */
const MAX_REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ReplayOptions {
  /** Instance ID to replay messages for */
  instanceId: string;
  /**
   * Replay messages received after this timestamp.
   * Defaults to `lastSeenAt` from the instance record.
   * Hard-capped at 24 hours ago regardless.
   */
  since?: Date;
}

export interface ReplayResult {
  instanceId: string;
  replayed: number;
  skipped: number;
  since: Date;
  until: Date;
}

export class AgentReplayService {
  constructor(
    private db: Database,
    private eventBus: EventBus,
  ) {}

  /**
   * Trigger replay for an instance on reconnect.
   * Checks if replay is enabled, then calls replayMissedMessages.
   * Updates `lastSeenAt` to now after replay completes.
   */
  async onInstanceConnect(instanceId: string): Promise<void> {
    const [instance] = await this.db
      .select({
        id: instances.id,
        channel: instances.channel,
        replayEnabled: instances.replayEnabled,
        lastSeenAt: instances.lastSeenAt,
        agentId: instances.agentId,
      })
      .from(instances)
      .where(eq(instances.id, instanceId))
      .limit(1);

    if (!instance) {
      log.warn('Instance not found for replay', { instanceId });
      return;
    }

    if (!instance.agentId) {
      log.debug('Instance has no agent, skipping replay', { instanceId });
      await this.updateLastSeenAt(instanceId);
      return;
    }

    if (!instance.replayEnabled) {
      log.debug('Replay disabled for instance', { instanceId });
      await this.updateLastSeenAt(instanceId);
      return;
    }

    const since = instance.lastSeenAt ?? null;

    if (!since) {
      log.debug('No lastSeenAt recorded, skipping replay (first connect)', { instanceId });
      await this.updateLastSeenAt(instanceId);
      return;
    }

    log.info('Starting replay on reconnect', { instanceId, since: since.toISOString() });

    try {
      const result = await this.replayMissedMessages({ instanceId, since });
      log.info('Replay complete', {
        instanceId,
        replayed: result.replayed,
        skipped: result.skipped,
        since: result.since.toISOString(),
      });
      await this.updateLastSeenAt(instanceId, result.until);
    } catch (error) {
      log.error('Replay failed', { instanceId, error: String(error) });
    }
  }

  /**
   * Replay missed messages for an instance.
   *
   * Fetches all inbound messages (isFromMe=false) received between `since`
   * (capped at 24h ago) and now, then re-publishes them as message.received
   * events on the event bus so the normal agent dispatcher handles them.
   */
  async replayMissedMessages(options: ReplayOptions): Promise<ReplayResult> {
    const { instanceId } = options;
    const now = new Date();
    const cutoff = new Date(now.getTime() - MAX_REPLAY_WINDOW_MS);

    // Clamp since to 24h window
    const since = options.since && options.since > cutoff ? options.since : cutoff;

    log.debug('Fetching missed messages', { instanceId, since: since.toISOString(), until: now.toISOString() });

    let cursorTimestamp = since;
    let cursorId: string | null = null;
    let totalReplayed = 0;
    let totalSkipped = 0;
    const PAGE_SIZE = 1000;

    while (true) {
      const rows = await this.db
        .select({
          id: messages.id,
          chatId: messages.chatId,
          externalId: messages.externalId,
          messageType: messages.messageType,
          textContent: messages.textContent,
          mediaUrl: messages.mediaUrl,
          mediaLocalPath: messages.mediaLocalPath,
          mediaMimeType: messages.mediaMimeType,
          senderPlatformUserId: messages.senderPlatformUserId,
          replyToExternalId: messages.replyToExternalId,
          rawPayload: messages.rawPayload,
          platformTimestamp: messages.platformTimestamp,
          isFromMe: messages.isFromMe,
          senderAgentId: messages.senderAgentId,
          // Join chat to get instanceId and externalId (the platform chat/JID)
          chatExternalId: chats.externalId,
          chatInstanceId: chats.instanceId,
        })
        .from(messages)
        .innerJoin(chats, eq(messages.chatId, chats.id))
        .where(
          and(
            eq(chats.instanceId, instanceId),
            eq(messages.isFromMe, false),
            // Only include non-agent-sent messages
            sql`${messages.senderAgentId} IS NULL`,
            // Only active messages
            sql`${messages.deletedAt} IS NULL`,
            // Composite cursor: (timestamp > cursor) OR (timestamp = cursor AND id > cursorId)
            // This avoids skipping messages with identical timestamps at page boundaries
            cursorId
              ? or(
                  gt(messages.platformTimestamp, cursorTimestamp),
                  and(eq(messages.platformTimestamp, cursorTimestamp), gt(messages.id, cursorId)),
                )
              : gt(messages.platformTimestamp, cursorTimestamp),
            lte(messages.platformTimestamp, now),
          ),
        )
        .orderBy(asc(messages.platformTimestamp), asc(messages.id))
        .limit(PAGE_SIZE);

      if (rows.length === 0) break;

      if (rows.length === PAGE_SIZE) {
        log.warn('Replay page cap hit, fetching next page', {
          instanceId,
          limit: PAGE_SIZE,
          cursor: cursorTimestamp.toISOString(),
        });
      }

      const counts = await this.redispatchRows(instanceId, rows);
      totalReplayed += counts.replayed;
      totalSkipped += counts.skipped;

      // Advance composite cursor to last row's (timestamp, id)
      // Safe: rows.length > 0 is guaranteed by the break above
      const lastRow = rows[rows.length - 1] as (typeof rows)[0];
      cursorTimestamp = lastRow.platformTimestamp;
      cursorId = lastRow.id;

      if (rows.length < PAGE_SIZE) break;
    }

    return { instanceId, replayed: totalReplayed, skipped: totalSkipped, since, until: now };
  }

  /**
   * Update `lastSeenAt` for an instance to now.
   * Called on both clean connect and disconnect so the next replay window is accurate.
   */
  async updateLastSeenAt(instanceId: string, timestamp?: Date): Promise<void> {
    await this.db
      .update(instances)
      .set({ lastSeenAt: timestamp ?? new Date() })
      .where(eq(instances.id, instanceId));
  }

  private async redispatchRows(
    instanceId: string,
    rows: { id: string; [k: string]: unknown }[],
  ): Promise<{ replayed: number; skipped: number }> {
    let replayed = 0;
    let skipped = 0;
    for (const row of rows) {
      try {
        await this.redispatchMessage(instanceId, row as Parameters<typeof this.redispatchMessage>[1]);
        replayed++;
      } catch (error) {
        log.warn('Failed to redispatch message during replay', {
          instanceId,
          messageId: row.id,
          error: String(error),
        });
        skipped++;
      }
    }
    return { replayed, skipped };
  }

  /**
   * Re-publish a stored message as a message.received event.
   * The existing agent dispatcher pipeline will handle it normally.
   */
  private async redispatchMessage(
    instanceId: string,
    row: {
      id: string;
      chatId: string;
      externalId: string;
      messageType: string;
      textContent: string | null;
      mediaUrl: string | null;
      mediaLocalPath: string | null;
      mediaMimeType: string | null;
      senderPlatformUserId: string | null;
      replyToExternalId: string | null;
      rawPayload: Record<string, unknown> | null;
      chatExternalId: string;
      chatInstanceId: string | null;
    },
  ): Promise<void> {
    // Map stored message type to ContentType
    const contentType = mapMessageTypeToContentType(row.messageType);

    const correlationId = generateCorrelationId('replay');

    await this.eventBus.publish(
      'message.received',
      {
        externalId: row.externalId,
        chatId: row.chatExternalId, // Use platform chat ID (JID, etc.)
        from: row.senderPlatformUserId ?? 'unknown',
        content: {
          type: contentType,
          text: row.textContent ?? undefined,
          mediaUrl: row.mediaUrl ?? row.mediaLocalPath ?? undefined,
          mimeType: row.mediaMimeType ?? undefined,
        },
        replyToId: row.replyToExternalId ?? undefined,
        rawPayload: row.rawPayload ?? undefined,
      },
      {
        correlationId,
        instanceId,
        source: 'agent-replay',
        // Use 'realtime' so the agent dispatcher processes the event normally.
        // The replay service ensures we only re-dispatch messages that were missed,
        // not historical messages the agent already handled.
        ingestMode: 'realtime',
      },
    );
  }
}

/**
 * Map a stored message type to an event bus ContentType.
 */
function mapMessageTypeToContentType(
  messageType: string,
): 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'location' | 'contact' | 'poll' | 'reaction' {
  switch (messageType) {
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'document':
      return 'document';
    case 'sticker':
      return 'sticker';
    case 'location':
      return 'location';
    case 'contact':
      return 'contact';
    case 'poll':
      return 'poll';
    case 'reaction':
      return 'reaction';
    default:
      return 'text';
  }
}
