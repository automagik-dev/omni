/**
 * Agent State Service
 *
 * Manages the ephemeral agent state machine using NATS KV.
 * Key pattern: `{agentId}:{chatId}` in the `agent-state` KV bucket.
 *
 * States: idle → thinking → typing → sending → idle
 *                   ↓
 *             running_task ──→ thinking  (loop)
 *                   ↓
 *                waiting ──→ thinking    (when unblocked)
 *                  ↓
 *                error ──→ idle
 */

import {
  AGENT_STATE_KV_BUCKET,
  type AgentChatState,
  AgentChatStateSchema,
  type AgentStatus,
  type AgentStatusMeta,
  NatsEventBus,
  agentStateKey,
  createLogger,
} from '@omni/core';
import type { EventBus } from '@omni/core';
import type { KV } from 'nats';
import { StringCodec } from 'nats';

const log = createLogger('services:agent-state');
const sc = StringCodec();

/**
 * KV TTL: 24 hours in milliseconds
 * NATS KV ttl is per-key in ms (requires server ≥ 2.11) or bucket-level max_age.
 * We set bucket-level ttl via max_age in the KvOptions.
 */
const KV_TTL_MS = 24 * 60 * 60 * 1000;

export class AgentStateService {
  private kv: KV | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(private readonly eventBus: EventBus | null) {}

  // ──────────────────────────────────────────────
  // Init
  // ──────────────────────────────────────────────

  /**
   * Lazily initialise the KV bucket (idempotent, only runs once).
   */
  private async ensureKv(): Promise<KV> {
    if (this.kv) return this.kv;

    if (!this.initPromise) {
      this.initPromise = this.initKv();
    }

    await this.initPromise;

    if (!this.kv) {
      throw new Error('AgentStateService: KV bucket unavailable');
    }
    return this.kv;
  }

  private async initKv(): Promise<void> {
    if (!(this.eventBus instanceof NatsEventBus)) {
      log.warn('AgentStateService: eventBus is not a NatsEventBus — state will not be persisted');
      return;
    }

    const js = this.eventBus.getJetStreamClient();
    if (!js) {
      log.warn('AgentStateService: JetStream client not available');
      return;
    }

    try {
      this.kv = await js.views.kv(AGENT_STATE_KV_BUCKET, {
        ttl: KV_TTL_MS,
      });
      log.info('AgentStateService: KV bucket ready', { bucket: AGENT_STATE_KV_BUCKET });
    } catch (err) {
      log.error('AgentStateService: failed to open KV bucket', { error: String(err) });
    }
  }

  // ──────────────────────────────────────────────
  // Core operations
  // ──────────────────────────────────────────────

  /**
   * Write agent state to NATS KV and publish `agent.state.changed` event.
   */
  async setState(
    agentId: string,
    chatId: string,
    status: AgentStatus,
    statusMeta?: AgentStatusMeta,
    conversationId: string | null = null,
  ): Promise<AgentChatState> {
    const state: AgentChatState = {
      agentId,
      chatId,
      conversationId,
      status,
      statusMeta,
      updatedAt: Date.now(),
    };

    try {
      const kv = await this.ensureKv();
      const key = agentStateKey(agentId, chatId);
      await kv.put(key, sc.encode(JSON.stringify(state)));
    } catch (err) {
      log.warn('AgentStateService: failed to write state to KV', {
        agentId,
        chatId,
        status,
        error: String(err),
      });
    }

    if (this.eventBus) {
      try {
        await this.eventBus.publish('agent.state.changed', {
          agentId,
          chatId,
          conversationId,
          status,
          statusMeta: statusMeta as Record<string, unknown> | undefined,
          updatedAt: state.updatedAt,
        });
      } catch (err) {
        log.warn('AgentStateService: failed to publish agent.state.changed', {
          agentId,
          chatId,
          error: String(err),
        });
      }
    }

    return state;
  }

  /**
   * Read current agent state from NATS KV.
   * Returns null if no state exists or if KV is unavailable.
   */
  async getState(agentId: string, chatId: string): Promise<AgentChatState | null> {
    try {
      const kv = await this.ensureKv();
      const key = agentStateKey(agentId, chatId);
      const entry = await kv.get(key);

      if (!entry) return null;

      const state = this.parseWatchEntry(entry);
      if (!state) return null;

      return state;
    } catch (err) {
      log.warn('AgentStateService: failed to read state from KV', {
        agentId,
        chatId,
        error: String(err),
      });
      return null;
    }
  }

  /**
   * Delete agent state from NATS KV (agent offline / clean shutdown).
   */
  async clearState(agentId: string, chatId: string): Promise<void> {
    try {
      const kv = await this.ensureKv();
      const key = agentStateKey(agentId, chatId);
      await kv.delete(key);
    } catch (err) {
      log.warn('AgentStateService: failed to clear state from KV', {
        agentId,
        chatId,
        error: String(err),
      });
    }
  }

  /**
   * List all active agent states.
   *
   * @param chatId - If provided, filter to only states for this chat.
   */
  async listActiveAgents(chatId?: string): Promise<AgentChatState[]> {
    const states: AgentChatState[] = [];
    const MAX_LIST_KEYS = 1000;
    const FETCH_CONCURRENCY = 50;

    try {
      const kv = await this.ensureKv();

      // Key pattern: `{agentId}:{chatId}`
      // If filtering by chatId we can't use a prefix filter since chatId is the suffix.
      // We iterate all keys and filter in JS.
      const iter = await kv.keys();
      const keys: string[] = [];

      for await (const key of iter) {
        keys.push(key);
        if (keys.length >= MAX_LIST_KEYS) break;
      }

      // Fetch in chunks to avoid unbounded concurrent requests
      for (let i = 0; i < keys.length; i += FETCH_CONCURRENCY) {
        const chunk = keys.slice(i, i + FETCH_CONCURRENCY);
        await Promise.all(
          chunk.map(async (key) => {
            const parts = key.split(':');
            if (parts.length !== 2) return;

            const [_keyAgentId, keyChatId] = parts as [string, string];

            if (chatId && keyChatId !== chatId) return;

            const entry = await kv.get(key);
            if (!entry) return;

            const state = this.parseWatchEntry(entry);
            if (state) states.push(state);
          }),
        );
      }
    } catch (err) {
      log.warn('AgentStateService: failed to list active agents', {
        chatId,
        error: String(err),
      });
    }

    return states;
  }

  /**
   * Watch for KV changes (used by SSE endpoint).
   *
   * Returns an async iterator that yields state updates.
   * Pass a `signal` AbortSignal to stop watching when the client disconnects.
   *
   * @param agentId - If provided, only yield updates for this agent.
   * @param chatId  - If provided, only yield updates for this chat.
   */
  async *watchChanges(
    opts: { agentId?: string; chatId?: string; signal?: AbortSignal } = {},
  ): AsyncGenerator<AgentChatState> {
    const { agentId, chatId, signal } = opts;

    let kv: KV;
    try {
      kv = await this.ensureKv();
    } catch {
      return;
    }

    const watcher = await kv.watch();

    try {
      for await (const entry of watcher) {
        if (signal?.aborted) break;

        const state = this.parseWatchEntry(entry);
        if (!state) continue;
        if (agentId && state.agentId !== agentId) continue;
        if (chatId && state.chatId !== chatId) continue;

        yield state;
      }
    } finally {
      watcher.stop();
    }
  }

  /**
   * Parse a KV watch entry into an AgentChatState, returning null if invalid or deleted.
   */
  private parseWatchEntry(entry: { operation: string; value: Uint8Array }): AgentChatState | null {
    if (entry.operation === 'DEL' || entry.operation === 'PURGE') return null;

    const raw = JSON.parse(sc.decode(entry.value));
    const parsed = AgentChatStateSchema.safeParse(raw);

    return parsed.success ? parsed.data : null;
  }
}
