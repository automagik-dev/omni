/**
 * A2A Stream Store
 *
 * In-memory store for pending SSE streams. Each `message/stream` request
 * creates a ReadableStream keyed by (instanceId, taskId). The dispatcher
 * writes parts via A2AChannelPlugin.sendMessage() which calls writePart().
 */

import type { A2ATaskState, TaskArtifactUpdateEvent, TaskStatusUpdateEvent } from './types';

interface StreamEntry {
  enqueue: (data: Uint8Array) => void;
  close: () => void;
  closeTimer?: ReturnType<typeof setTimeout>;
  partIndex: number;
}

const IDLE_CLOSE_MS = 30_000;
const MAX_STREAMS = 5000;
const MAX_STREAMS_PER_INSTANCE = 100;

export class A2AStreamStore {
  private readonly streams = new Map<string, StreamEntry>();
  private readonly encoder = new TextEncoder();

  streamKey(instanceId: string, taskId: string): string {
    return `${instanceId}:${taskId}`;
  }

  /**
   * Create a pending SSE stream for the given instance + task.
   * The stream auto-closes after IDLE_CLOSE_MS of inactivity.
   */
  createPendingStream(instanceId: string, taskId: string): ReadableStream<Uint8Array> {
    if (this.streams.size >= MAX_STREAMS) {
      throw new Error('Stream store capacity exceeded');
    }

    let instanceCount = 0;
    for (const key of this.streams.keys()) {
      if (key.startsWith(`${instanceId}:`)) {
        instanceCount++;
      }
    }
    if (instanceCount >= MAX_STREAMS_PER_INSTANCE) {
      throw new Error(`Stream limit exceeded for instance ${instanceId}`);
    }

    const key = this.streamKey(instanceId, taskId);
    const store = this;

    // Close any existing stream before replacing it
    const existing = this.streams.get(key);
    if (existing) {
      if (existing.closeTimer !== undefined) clearTimeout(existing.closeTimer);
      existing.close();
    }

    let entryRef: StreamEntry;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const entry: StreamEntry = {
          enqueue: (data) => {
            try {
              controller.enqueue(data);
            } catch {
              // Stream cancelled by client
            }
          },
          close: () => {
            try {
              controller.close();
            } catch {
              // Already closed
            }
            if (store.streams.get(key) === entryRef) {
              store.streams.delete(key);
            }
          },
          partIndex: 0,
        };

        entryRef = entry;
        store.streams.set(key, entry);

        // Auto-close on idle (no parts received)
        entry.closeTimer = setTimeout(() => {
          store.closeStream(instanceId, taskId, 'failed');
        }, IDLE_CLOSE_MS);
      },
      cancel() {
        if (store.streams.get(key) === entryRef) {
          if (entryRef.closeTimer !== undefined) {
            clearTimeout(entryRef.closeTimer);
          }
          store.streams.delete(key);
        }
      },
    });

    return stream;
  }

  /**
   * Write a response part to the pending stream.
   * Resets the idle close timer.
   */
  writePart(instanceId: string, taskId: string, text: string): void {
    const key = this.streamKey(instanceId, taskId);
    const entry = this.streams.get(key);
    if (!entry) return;

    // Reset idle timer
    if (entry.closeTimer !== undefined) {
      clearTimeout(entry.closeTimer);
    }

    entry.partIndex++;

    const event: TaskArtifactUpdateEvent = {
      type: 'taskArtifactUpdateEvent',
      taskId,
      artifact: {
        artifactId: `part-${entry.partIndex}`,
        index: entry.partIndex - 1,
        parts: [{ type: 'text', text }],
        lastChunk: false,
      },
    };

    const sseData = `data: ${JSON.stringify(event)}\n\n`;
    entry.enqueue(this.encoder.encode(sseData));

    // Re-schedule auto-close
    entry.closeTimer = setTimeout(() => {
      this.closeStream(instanceId, taskId, 'failed');
    }, IDLE_CLOSE_MS);
  }

  /**
   * Close the pending stream with a final status event.
   */
  closeStream(instanceId: string, taskId: string, state: A2ATaskState): void {
    const key = this.streamKey(instanceId, taskId);
    const entry = this.streams.get(key);
    if (!entry) return;

    if (entry.closeTimer !== undefined) {
      clearTimeout(entry.closeTimer);
    }

    const statusEvent: TaskStatusUpdateEvent = {
      type: 'taskStatusUpdateEvent',
      taskId,
      status: { state, timestamp: new Date().toISOString() },
      final: true,
    };

    const sseData = `data: ${JSON.stringify(statusEvent)}\n\n`;
    entry.enqueue(this.encoder.encode(sseData));
    entry.close();
  }

  hasStream(instanceId: string, taskId: string): boolean {
    return this.streams.has(this.streamKey(instanceId, taskId));
  }
}
