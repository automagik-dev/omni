/**
 * A2A Stream Store
 *
 * In-memory store for pending SSE streams. Each `SendStreamingMessage` request
 * creates a ReadableStream keyed by (instanceId, taskId). The dispatcher
 * writes parts via A2AChannelPlugin.sendMessage() which calls writePart().
 */

import { textPart } from './task-store';
import type { A2AArtifact, A2AStreamResponse, A2ATask, A2ATaskState } from './types';

interface StreamEntry {
  enqueue: (data: Uint8Array) => void;
  close: () => void;
  closeTimer?: ReturnType<typeof setTimeout>;
  contextId: string;
  partIndex: number;
  rpcId: string | number | null;
}

type StreamCloseObserver = (instanceId: string, taskId: string, state: A2ATaskState) => void;

const IDLE_CLOSE_MS = 30_000;
const MAX_STREAMS = 5000;
const MAX_STREAMS_PER_INSTANCE = 100;

export class A2AStreamStore {
  private readonly streams = new Map<string, StreamEntry>();
  private readonly encoder = new TextEncoder();

  constructor(private readonly onClose?: StreamCloseObserver) {}

  streamKey(instanceId: string, taskId: string): string {
    return `${instanceId}:${taskId}`;
  }

  /**
   * Create a pending SSE stream for the given instance + task.
   * The stream auto-closes after IDLE_CLOSE_MS of inactivity.
   */
  createPendingStream(
    instanceId: string,
    taskId: string,
    rpcId: string | number | null = null,
    contextId = taskId,
  ): ReadableStream<Uint8Array> {
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
          contextId,
          partIndex: 0,
          rpcId,
        };

        entryRef = entry;
        store.streams.set(key, entry);

        // Auto-close on idle (no parts received)
        entry.closeTimer = setTimeout(() => {
          store.closeStream(instanceId, taskId, 'TASK_STATE_FAILED');
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
  writeTask(instanceId: string, taskId: string, task: A2ATask): void {
    const key = this.streamKey(instanceId, taskId);
    const entry = this.streams.get(key);
    if (!entry) return;

    this.resetIdleTimer(instanceId, taskId, entry);
    this.writeStreamResponse(entry, { task });
  }

  writePart(instanceId: string, taskId: string, text: string): void {
    const key = this.streamKey(instanceId, taskId);
    const entry = this.streams.get(key);
    if (!entry) return;

    this.resetIdleTimer(instanceId, taskId, entry);

    entry.partIndex++;

    const artifact: A2AArtifact = {
      artifactId: `artifact-${entry.partIndex}`,
      parts: [textPart(text)],
    };

    this.writeStreamResponse(entry, {
      taskArtifactUpdate: {
        taskId,
        contextId: entry.contextId,
        artifact,
        index: entry.partIndex - 1,
      },
    });
  }

  /**
   * Close the pending stream with a terminal status event.
   */
  closeStream(instanceId: string, taskId: string, state: A2ATaskState): void {
    const key = this.streamKey(instanceId, taskId);
    const entry = this.streams.get(key);
    if (!entry) return;

    if (entry.closeTimer !== undefined) {
      clearTimeout(entry.closeTimer);
    }

    this.writeStreamResponse(entry, {
      taskStatusUpdate: {
        taskId,
        contextId: entry.contextId,
        status: { state, timestamp: new Date().toISOString() },
      },
    });
    this.onClose?.(instanceId, taskId, state);
    entry.close();
  }

  hasStream(instanceId: string, taskId: string): boolean {
    return this.streams.has(this.streamKey(instanceId, taskId));
  }

  private resetIdleTimer(instanceId: string, taskId: string, entry: StreamEntry): void {
    if (entry.closeTimer !== undefined) {
      clearTimeout(entry.closeTimer);
    }

    entry.closeTimer = setTimeout(() => {
      this.closeStream(instanceId, taskId, 'TASK_STATE_FAILED');
    }, IDLE_CLOSE_MS);
  }

  private writeStreamResponse(entry: StreamEntry, result: A2AStreamResponse): void {
    const sseData = `data: ${JSON.stringify({ jsonrpc: '2.0', id: entry.rpcId, result })}\n\n`;
    entry.enqueue(this.encoder.encode(sseData));
  }
}
