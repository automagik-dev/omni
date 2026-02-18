/**
 * Per-chat sequential message processing queue.
 *
 * Ensures messages within the same chat (identified by chatId:threadId) are
 * processed in order, preventing race conditions. Different chats process
 * concurrently.
 *
 * LIMITATIONS (per DEC-7):
 * - Per-instance only — does not provide ordering guarantees across
 *   horizontally replicated bot instances.
 * - For multi-instance deployments, external coordination (e.g., distributed
 *   lock) would be needed (out of scope).
 */

import { createLogger } from '@omni/core';

const log = createLogger('telegram:sequentialize');

/**
 * Build a session key from chatId and optional threadId.
 * Key format: `chatId` or `chatId:threadId`
 */
export function getSessionKey(chatId: string, threadId: string | undefined): string {
  return threadId ? `${chatId}:${threadId}` : chatId;
}

/**
 * Per-chat message processing queue.
 *
 * Each unique key (chatId:threadId) gets its own sequential queue.
 * Different keys process concurrently.
 */
export class ChatQueue {
  private readonly queues = new Map<string, Promise<void>>();

  /**
   * Enqueue a task for sequential processing within its key.
   * Tasks with the same key are processed in FIFO order.
   * Tasks with different keys run concurrently.
   */
  enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const currentQueue = this.queues.get(key) ?? Promise.resolve();

    // Chain onto the existing queue for this key
    const newTask = currentQueue
      .then(() => task())
      .catch((err) => {
        // Re-throw to caller, but don't break the queue chain
        throw err;
      });

    // Update the queue with a version that always resolves (so next task can chain)
    const queueContinuation = newTask
      .then(() => {})
      .catch(() => {})
      .finally(() => {
        // Clean up queue entry if nothing else is queued
        if (this.queues.get(key) === queueContinuation) {
          this.queues.delete(key);
        }
      });

    this.queues.set(key, queueContinuation);

    return newTask;
  }

  /**
   * Get the number of active queue keys.
   */
  get activeQueues(): number {
    return this.queues.size;
  }

  /**
   * Clear all queues (for shutdown).
   */
  clear(): void {
    this.queues.clear();
  }
}

/** Singleton per-instance chat queues (instanceId -> ChatQueue) */
const instanceQueues = new Map<string, ChatQueue>();

/**
 * Get or create a ChatQueue for an instance.
 */
export function getChatQueue(instanceId: string): ChatQueue {
  let queue = instanceQueues.get(instanceId);
  if (!queue) {
    queue = new ChatQueue();
    instanceQueues.set(instanceId, queue);
    log.debug('Created chat queue for instance', { instanceId });
  }
  return queue;
}

/**
 * Remove a ChatQueue for an instance (on disconnect).
 */
export function removeChatQueue(instanceId: string): void {
  const queue = instanceQueues.get(instanceId);
  if (queue) {
    queue.clear();
    instanceQueues.delete(instanceId);
    log.debug('Removed chat queue for instance', { instanceId });
  }
}
