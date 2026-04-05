/**
 * Turn service — manages turn-based agent execution lifecycle.
 *
 * A "turn" is a single agent work session triggered by an inbound message.
 * The agent gets a sandboxed environment (scoped API key, env vars, verb commands)
 * and communicates via `omni say/send/speak/done` etc.
 *
 * Turn lifecycle: open → agent works → done/timeout
 */

import { createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { type NewTurn, type Turn, type TurnAction, type TurnStatus, turns } from '@omni/db';
import { and, eq, lt, sql } from 'drizzle-orm';

const log = createLogger('turns');

export interface OpenTurnOptions {
  instanceId: string;
  chatId: string;
  messageId: string;
  agentId: string;
  apiKeyId: string;
  metadata?: Record<string, unknown>;
}

export interface CloseTurnOptions {
  action: TurnAction;
  reason?: string;
}

export class TurnService {
  constructor(private db: Database) {}

  /**
   * Open a new turn for a message. Returns the created turn row.
   */
  async open(options: OpenTurnOptions): Promise<Turn> {
    const data: NewTurn = {
      instanceId: options.instanceId,
      chatId: options.chatId,
      messageId: options.messageId,
      agentId: options.agentId,
      apiKeyId: options.apiKeyId,
      status: 'open',
      metadata: options.metadata,
    };

    const [turn] = await this.db.insert(turns).values(data).returning();

    if (!turn) {
      throw new Error('Failed to create turn');
    }

    log.info('Turn opened', {
      turnId: turn.id,
      instanceId: options.instanceId,
      chatId: options.chatId,
      agentId: options.agentId,
    });

    return turn;
  }

  /**
   * Record activity on an open turn (extends the inactivity timer).
   * Called automatically by auth middleware on any API request from the scoped key.
   */
  async recordActivity(turnId: string): Promise<void> {
    await this.db
      .update(turns)
      .set({ lastActivityAt: new Date() })
      .where(and(eq(turns.id, turnId), eq(turns.status, 'open')));
  }

  /**
   * Close a turn with an action and optional reason.
   */
  async close(turnId: string, options: CloseTurnOptions): Promise<Turn | null> {
    const now = new Date();

    const [closed] = await this.db
      .update(turns)
      .set({
        status: (options.action === 'timeout' ? 'timeout' : 'done') as TurnStatus,
        action: options.action,
        closedAt: now,
        closedReason: options.reason,
      })
      .where(and(eq(turns.id, turnId), eq(turns.status, 'open')))
      .returning();

    if (closed) {
      const durationMs = now.getTime() - closed.startedAt.getTime();
      log.info('Turn closed', {
        turnId,
        action: options.action,
        durationMs,
        nudgeCount: closed.nudgeCount,
        messagesSent: closed.messagesSent,
      });
    }

    return closed ?? null;
  }

  /**
   * Get the currently open turn for an instance+chat pair (at most one).
   */
  async getOpen(instanceId: string, chatId: string): Promise<Turn | null> {
    const [turn] = await this.db
      .select()
      .from(turns)
      .where(and(eq(turns.instanceId, instanceId), eq(turns.chatId, chatId), eq(turns.status, 'open')))
      .limit(1);

    return turn ?? null;
  }

  /**
   * Get the open turn for a specific API key (used by auth middleware).
   */
  async getOpenByApiKey(apiKeyId: string): Promise<Turn | null> {
    const [turn] = await this.db
      .select()
      .from(turns)
      .where(and(eq(turns.apiKeyId, apiKeyId), eq(turns.status, 'open')))
      .limit(1);

    return turn ?? null;
  }

  /**
   * Get a turn by ID.
   */
  async getById(turnId: string): Promise<Turn | null> {
    const [turn] = await this.db.select().from(turns).where(eq(turns.id, turnId)).limit(1);
    return turn ?? null;
  }

  /**
   * Get all open turns that have been idle longer than the given threshold.
   * Used by the turn monitor to detect stale turns.
   */
  async getStale(inactivityMs: number): Promise<Turn[]> {
    const threshold = new Date(Date.now() - inactivityMs);

    return this.db
      .select()
      .from(turns)
      .where(and(eq(turns.status, 'open'), lt(turns.lastActivityAt, threshold)));
  }

  /**
   * Increment the nudge counter for a turn.
   */
  async incrementNudge(turnId: string): Promise<void> {
    await this.db
      .update(turns)
      .set({ nudgeCount: sql`${turns.nudgeCount} + 1` })
      .where(eq(turns.id, turnId));
  }

  /**
   * Increment the messages-sent counter for a turn.
   * Called when any verb command (say, send, speak, etc.) succeeds during the turn.
   */
  async incrementMessages(turnId: string): Promise<void> {
    await this.db
      .update(turns)
      .set({ messagesSent: sql`${turns.messagesSent} + 1` })
      .where(eq(turns.id, turnId));
  }
}
