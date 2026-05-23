/**
 * A2AStreamStore unit tests
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { A2AStreamStore } from '../stream-store';

// Collect SSE text from a ReadableStream
async function readSSE(stream: ReadableStream<Uint8Array>, maxChunks = 10): Promise<string[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const events: string[] = [];
  let raw = '';

  for (let i = 0; i < maxChunks; i++) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value);
  }

  reader.releaseLock();

  // Split on \n\n (SSE event boundaries)
  for (const block of raw.split('\n\n')) {
    const line = block.trim();
    if (line.startsWith('data: ')) {
      events.push(line.slice(6));
    }
  }

  return events;
}

describe('A2AStreamStore', () => {
  let store: A2AStreamStore;

  beforeEach(() => {
    // Replace setInterval/setTimeout to avoid hanging timers
    store = new A2AStreamStore();
  });

  afterEach(() => {
    // Close all open streams to clear any pending idle-close timers (IDLE_CLOSE_MS = 30_000).
    // Tests that call createPendingStream() without a matching closeStream() leave dangling timers.
    const allKnownKeys: Array<[string, string]> = [
      ['inst-1', 'task-1'],
      ['inst-1', 'task-2'],
      ['inst-1', 'task-3'],
      ['inst-1', 'task-4'],
      ['inst-1', 'task-5'],
      ['inst-1', 'task-a'],
      ['inst-1', 'task-b'],
    ];
    for (const [instanceId, taskId] of allKnownKeys) {
      if (store.hasStream(instanceId, taskId)) {
        store.closeStream(instanceId, taskId, 'TASK_STATE_COMPLETED');
      }
    }
    mock.restore();
  });

  describe('streamKey', () => {
    it('formats key as instanceId:taskId', () => {
      expect(store.streamKey('inst-1', 'task-1')).toBe('inst-1:task-1');
    });
  });

  describe('hasStream', () => {
    it('returns false before a stream is created', () => {
      expect(store.hasStream('inst-1', 'task-1')).toBe(false);
    });

    it('returns true after createPendingStream', () => {
      store.createPendingStream('inst-1', 'task-1');
      expect(store.hasStream('inst-1', 'task-1')).toBe(true);
    });

    it('returns false after stream is closed', () => {
      store.createPendingStream('inst-1', 'task-2');
      store.closeStream('inst-1', 'task-2', 'TASK_STATE_COMPLETED');
      expect(store.hasStream('inst-1', 'task-2')).toBe(false);
    });
  });

  describe('createPendingStream', () => {
    it('returns a ReadableStream', () => {
      const stream = store.createPendingStream('inst-1', 'task-1');
      expect(stream).toBeInstanceOf(ReadableStream);
    });

    it('creates separate streams for different task IDs', () => {
      store.createPendingStream('inst-1', 'task-a');
      store.createPendingStream('inst-1', 'task-b');
      expect(store.hasStream('inst-1', 'task-a')).toBe(true);
      expect(store.hasStream('inst-1', 'task-b')).toBe(true);
    });

    it('closes idle streams without reporting task failure', async () => {
      const onClose = mock((_instanceId: string, _taskId: string, _state: string) => {});
      const idleStore = new A2AStreamStore(onClose, 1);
      const stream = idleStore.createPendingStream('inst-1', 'idle-task');
      const reader = stream.getReader();

      const result = await reader.read();
      reader.releaseLock();

      expect(result.done).toBe(true);
      expect(onClose).not.toHaveBeenCalled();
      expect(idleStore.hasStream('inst-1', 'idle-task')).toBe(false);
    });
  });

  describe('writePart', () => {
    it('writes a taskArtifactUpdateEvent SSE chunk to the stream', async () => {
      const stream = store.createPendingStream('inst-1', 'task-1');

      store.writePart('inst-1', 'task-1', 'hello world');
      store.closeStream('inst-1', 'task-1', 'TASK_STATE_COMPLETED');

      const events = await readSSE(stream);
      expect(events.length).toBeGreaterThanOrEqual(1);

      const frame = JSON.parse(events[0] ?? '');
      expect(frame.jsonrpc).toBe('2.0');
      expect(frame.result.taskArtifactUpdate.taskId).toBe('task-1');
      expect(frame.result.taskArtifactUpdate.contextId).toBe('task-1');
      expect(frame.result.taskArtifactUpdate.index).toBe(0);
      expect(frame.result.taskArtifactUpdate.append).toBeUndefined();
      expect(frame.result.taskArtifactUpdate.lastChunk).toBeUndefined();
      expect(frame.result.taskArtifactUpdate.artifact.parts[0].text).toBe('hello world');
    });

    it('increments partIndex for each part', async () => {
      const stream = store.createPendingStream('inst-1', 'task-2');

      store.writePart('inst-1', 'task-2', 'first');
      store.writePart('inst-1', 'task-2', 'second');
      store.closeStream('inst-1', 'task-2', 'TASK_STATE_COMPLETED');

      const events = await readSSE(stream, 20);
      const artifact1 = JSON.parse(events[0] ?? '').result.taskArtifactUpdate;
      const artifact2 = JSON.parse(events[1] ?? '').result.taskArtifactUpdate;

      expect(artifact1.artifact.artifactId).toBe('artifact-1');
      expect(artifact2.artifact.artifactId).toBe('artifact-2');
      expect(artifact1.index).toBe(0);
      expect(artifact2.index).toBe(1);
    });

    it('is a no-op when no stream exists for the key', () => {
      // Should not throw
      expect(() => store.writePart('inst-1', 'nonexistent', 'text')).not.toThrow();
    });
  });

  describe('closeStream', () => {
    it('writes a final taskStatusUpdateEvent before closing', async () => {
      const stream = store.createPendingStream('inst-1', 'task-3');
      store.closeStream('inst-1', 'task-3', 'TASK_STATE_COMPLETED');

      const events = await readSSE(stream);
      expect(events.length).toBe(1);

      const status = JSON.parse(events[0] ?? '').result.taskStatusUpdate;
      expect(status.taskId).toBe('task-3');
      expect(status.contextId).toBe('task-3');
      expect(status.status.state).toBe('TASK_STATE_COMPLETED');
      expect(status.final).toBeUndefined();
    });

    it('supports failed state in status event', async () => {
      const stream = store.createPendingStream('inst-1', 'task-4');
      store.closeStream('inst-1', 'task-4', 'TASK_STATE_FAILED');

      const events = await readSSE(stream);
      const status = JSON.parse(events[0] ?? '').result.taskStatusUpdate;
      expect(status.status.state).toBe('TASK_STATE_FAILED');
    });

    it('is a no-op when called on nonexistent stream', () => {
      expect(() => store.closeStream('inst-1', 'ghost', 'TASK_STATE_COMPLETED')).not.toThrow();
    });

    it('removes the stream from the store', () => {
      store.createPendingStream('inst-1', 'task-5');
      store.closeStream('inst-1', 'task-5', 'TASK_STATE_COMPLETED');
      expect(store.hasStream('inst-1', 'task-5')).toBe(false);
    });
  });
});
