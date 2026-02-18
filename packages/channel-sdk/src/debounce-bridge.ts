/**
 * Debounce Bridge
 *
 * Bridges the core DebounceManager into channel message handlers.
 * Wraps rapid messages from the same sender into a single batched callback.
 *
 * DEC-2: Wired at channel-sdk level for consistency across channels.
 * DEC-6: Idle windows evicted after 5 min (configurable via idleTimeoutMs).
 */

import {
  type ConversationKey,
  type DebounceCallback,
  type DebounceConfig,
  DebounceManager,
  type DebouncedMessage,
  type Logger,
  buildConversationKey,
} from '@omni/core';

export interface DebounceBridgeConfig {
  mode: 'none' | 'fixed' | 'range' | 'presence';
  windowMs?: number;
  idleTimeoutMs?: number;
}

export interface DebounceBridgeMessage {
  senderId: string;
  senderName?: string;
  instanceId: string;
  content: string;
  type?: string;
  timestamp?: number;
  payload?: Record<string, unknown>;
}

export type BatchCallback = (
  instanceId: string,
  senderId: string,
  batchedContent: string,
  messages: DebouncedMessage[],
  senderName?: string,
) => void;

export interface DebounceBridge {
  push(msg: DebounceBridgeMessage): void;
  handlePresence(instanceId: string, senderId: string, eventType: string): void;
  flush(): void;
  readonly activeWindowCount: number;
}

function buildDebounceConfig(cfg: DebounceBridgeConfig): DebounceConfig {
  const windowMs = cfg.windowMs ?? 1500;

  switch (cfg.mode) {
    case 'none':
      return { mode: 'none' };
    case 'fixed':
      return { mode: 'fixed', delayMs: windowMs };
    case 'range':
      return { mode: 'range', minMs: windowMs, maxMs: windowMs * 2 };
    case 'presence':
      return {
        mode: 'presence',
        baseDelayMs: windowMs,
        maxWaitMs: windowMs * 10,
        extendOnEvents: ['composing', 'recording'],
      };
    default:
      return { mode: 'none' };
  }
}

/**
 * Create a debounce bridge for a channel handler.
 *
 * The bridge wraps DebounceManager and adds:
 * - Idle window eviction after `idleTimeoutMs` (default 5 min)
 * - Structured logging for batch and eviction events
 * - Content concatenation with newline separator
 */
export function createDebounceBridge(
  config: DebounceBridgeConfig,
  onBatch: BatchCallback,
  logger: Logger,
): DebounceBridge {
  const idleTimeoutMs = config.idleTimeoutMs ?? 300_000; // 5 minutes
  const windowMs = config.windowMs ?? 1500;

  // Track idle timers per conversation key
  const idleTimers = new Map<ConversationKey, ReturnType<typeof setTimeout>>();
  // Track window start times for actualWindowMs calculation
  const windowStarts = new Map<ConversationKey, number>();

  const debounceCallback: DebounceCallback = (key, messages, from, instanceId) => {
    // Clear idle timer
    const idleTimer = idleTimers.get(key);
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimers.delete(key);
    }

    const startTime = windowStarts.get(key);
    windowStarts.delete(key);
    const actualWindowMs = startTime ? Date.now() - startTime : 0;

    // Concatenate content with newline separator
    const batchedContent = messages.map((m) => m.text ?? '').join('\n');

    logger.info('debounce_batch', {
      event: 'debounce_batch',
      senderId: from.id,
      instanceId,
      messageCount: messages.length,
      windowMs,
      actualWindowMs,
      mode: config.mode,
    });

    onBatch(instanceId, from.id, batchedContent, messages, from.name);
  };

  const debounceConfig = buildDebounceConfig(config);
  const manager = new DebounceManager(debounceConfig, debounceCallback);

  function resetIdleTimer(key: ConversationKey, instanceId: string, senderId: string): void {
    const existing = idleTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      idleTimers.delete(key);
      windowStarts.delete(key);

      // Flush any pending messages in this window
      const pending = manager.getPendingCount(key);

      logger.info('debounce_window_evicted', {
        event: 'debounce_window_evicted',
        senderId,
        instanceId,
        idleDurationMs: idleTimeoutMs,
        pendingMessages: pending,
      });
    }, idleTimeoutMs);

    // Don't keep process alive for idle timers
    if (timer.unref) timer.unref();
    idleTimers.set(key, timer);
  }

  function push(msg: DebounceBridgeMessage): void {
    const key = buildConversationKey(msg.instanceId, msg.senderId);

    // Track window start
    if (!windowStarts.has(key)) {
      windowStarts.set(key, Date.now());
    }

    const debounceMsg: DebouncedMessage = {
      type: msg.type ?? 'text',
      text: msg.content,
      timestamp: msg.timestamp ?? Date.now(),
      payload: msg.payload ?? {},
    };

    manager.addMessage(key, debounceMsg, { id: msg.senderId, name: msg.senderName }, msg.instanceId);

    // Reset idle timer
    resetIdleTimer(key, msg.instanceId, msg.senderId);
  }

  function handlePresence(instanceId: string, senderId: string, eventType: string): void {
    const key = buildConversationKey(instanceId, senderId);
    manager.handlePresenceEvent(key, eventType);
    resetIdleTimer(key, instanceId, senderId);
  }

  function flush(): void {
    // Clear all idle timers
    for (const timer of idleTimers.values()) {
      clearTimeout(timer);
    }
    idleTimers.clear();
    windowStarts.clear();
    manager.flushAll();
  }

  return {
    push,
    handlePresence,
    flush,
    get activeWindowCount() {
      return manager.getActiveWindowCount();
    },
  };
}
