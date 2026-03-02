/**
 * A2A Protocol Client
 *
 * HTTP + SSE client for calling external A2A-compatible agents.
 * Implements IAgentClient over the A2A JSON-RPC protocol.
 *
 * message/send  → sync: polls until terminal state
 * message/stream → async: parses SSE taskArtifactUpdateEvent chunks
 */

import { createLogger } from '../logger';
import { ProviderError } from './types';
import type { IAgentClient, ProviderRequest, ProviderResponse, StreamChunk } from './types';

const log = createLogger('providers:a2a-client');

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_POLL_ATTEMPTS = 60;
const POLL_INTERVAL_MS = 1_000;

export interface A2AClientConfig {
  /** A2A endpoint URL (e.g. https://example.com/a2a/instance-id) */
  baseUrl: string;
  apiKey?: string;
  defaultTimeoutMs?: number;
}

export class A2AClient implements IAgentClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly defaultTimeoutMs: number;

  constructor(config: A2AClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // ─── IAgentClient ─────────────────────────────────────────────

  async run(request: ProviderRequest): Promise<ProviderResponse> {
    const startMs = Date.now();
    const body = this.buildJsonRpcRequest('message/send', request);

    const response = await this.post(body, request.timeoutMs ?? this.defaultTimeoutMs);
    if (!response.ok) {
      throw new ProviderError(`A2A request failed: ${response.status}`, 'SERVER_ERROR', response.status);
    }
    const result = (await response.json()) as Record<string, unknown>;

    if (result.error) {
      const err = result.error as { message: string; code: number };
      throw new ProviderError(err.message, 'SERVER_ERROR', undefined, { code: err.code });
    }

    const taskResult = result.result as Record<string, unknown> | undefined;
    const task = taskResult?.task as Record<string, unknown> | undefined;
    const taskId = (task?.id ?? '') as string;

    // If state is already terminal, return immediately
    const state = (task?.status as Record<string, unknown> | undefined)?.state as string | undefined;
    if (state === 'completed' || state === 'failed') {
      return this.taskToProviderResponse(task, taskId, startMs);
    }

    // Otherwise poll until terminal
    return this.pollUntilComplete(taskId, startMs, request.timeoutMs ?? this.defaultTimeoutMs);
  }

  async *stream(request: ProviderRequest): AsyncGenerator<StreamChunk> {
    const body = this.buildJsonRpcRequest('message/stream', request);
    const controller = new AbortController();
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      throw new ProviderError(error instanceof Error ? error.message : 'Network error', 'NETWORK_ERROR');
    }

    if (!response.ok) {
      clearTimeout(timer);
      throw new ProviderError(`A2A stream failed: ${response.status}`, 'SERVER_ERROR', response.status);
    }

    if (!response.body) {
      clearTimeout(timer);
      throw new ProviderError('No response body', 'INVALID_RESPONSE');
    }

    const decoder = new TextDecoder();
    try {
      yield* this.readSseChunks(response.body as ReadableStream<Uint8Array>, decoder);
    } finally {
      clearTimeout(timer);
    }
  }

  async checkHealth(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ jsonrpc: '2.0', id: 'health', method: 'tasks/get', params: { id: 'ping' } }),
        signal: AbortSignal.timeout(5_000),
      });
      return { healthy: response.ok, latencyMs: Date.now() - start };
    } catch (error) {
      return { healthy: false, latencyMs: Date.now() - start, error: String(error) };
    }
  }

  // ─── Private helpers ──────────────────────────────────────────

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      ...extra,
    };
  }

  private async post(body: unknown, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      return response;
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ProviderError('Request timed out', 'TIMEOUT', undefined, { timeoutMs });
      }
      throw new ProviderError(error instanceof Error ? error.message : 'Network error', 'NETWORK_ERROR');
    }
  }

  private buildJsonRpcRequest(method: string, request: ProviderRequest): unknown {
    return {
      jsonrpc: '2.0',
      id: `omni-${crypto.randomUUID()}`,
      method,
      params: {
        message: {
          role: 'user',
          parts: [{ type: 'text', text: request.message }],
          messageId: `msg-${crypto.randomUUID()}`,
        },
        configuration: {
          acceptedOutputModes: ['text'],
        },
        contextId: request.sessionId,
      },
    };
  }

  /** Reads the SSE stream and yields parsed StreamChunks. */
  private async *readSseChunks(body: ReadableStream<Uint8Array>, decoder: TextDecoder): AsyncGenerator<StreamChunk> {
    const reader = body.getReader();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const chunk = this.parseSseLine(line);
          if (chunk) yield chunk;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** Parses a single SSE line and returns a StreamChunk or null. */
  private parseSseLine(line: string): StreamChunk | null {
    if (!line.startsWith('data: ')) return null;
    const data = line.slice(6).trim();
    if (!data || data === '[DONE]') return null;
    try {
      const event = JSON.parse(data) as Record<string, unknown>;
      return this.parseSSEEvent(event);
    } catch (e) {
      log.warn('Failed to parse A2A SSE event', { data, error: String(e) });
      return null;
    }
  }

  private parseSSEEvent(event: Record<string, unknown>): StreamChunk | null {
    const type = event.type as string | undefined;

    if (type === 'taskArtifactUpdateEvent') {
      const artifact = event.artifact as Record<string, unknown> | undefined;
      if (!artifact) return null;
      const parts = (artifact.parts as Array<Record<string, unknown>>) ?? [];
      const textParts = parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text as string)
        .join('');
      if (!textParts) return null;
      return {
        event: 'artifact',
        content: textParts,
        isComplete: false,
        runId: event.taskId as string | undefined,
      };
    }

    if (type === 'taskStatusUpdateEvent') {
      const status = event.status as Record<string, unknown> | undefined;
      const state = status?.state as string | undefined;
      const isFinal = event.final === true || state === 'completed' || state === 'failed';
      if (isFinal) {
        return {
          event: 'final',
          isComplete: true,
          runId: event.taskId as string | undefined,
        };
      }
    }

    return null;
  }

  private taskToProviderResponse(
    task: Record<string, unknown> | undefined,
    taskId: string,
    startMs: number,
  ): ProviderResponse {
    const artifacts = (task?.artifacts as Array<Record<string, unknown>>) ?? [];
    const textParts: string[] = [];
    for (const artifact of artifacts) {
      const parts = (artifact.parts as Array<Record<string, unknown>>) ?? [];
      for (const part of parts) {
        if (part.type === 'text' && part.text) {
          textParts.push(part.text as string);
        }
      }
    }

    const status = task?.status as Record<string, unknown> | undefined;
    const state = status?.state as string | undefined;

    return {
      content: textParts.join('\n'),
      runId: taskId,
      sessionId: (task?.contextId as string | undefined) ?? taskId,
      status: state === 'failed' ? 'failed' : 'completed',
      metrics: {
        inputTokens: 0,
        outputTokens: 0,
        durationMs: Date.now() - startMs,
      },
    };
  }

  private async pollUntilComplete(taskId: string, startMs: number, timeoutMs: number): Promise<ProviderResponse> {
    const deadline = startMs + timeoutMs;

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      if (Date.now() >= deadline) {
        throw new ProviderError('A2A task timed out while polling', 'TIMEOUT', undefined, { taskId });
      }

      const body = {
        jsonrpc: '2.0',
        id: `poll-${attempt}`,
        method: 'tasks/get',
        params: { id: taskId },
      };

      const response = await this.post(body, Math.min(10_000, Math.max(0, deadline - Date.now())));
      if (!response.ok) {
        throw new ProviderError(`A2A poll failed: ${response.status}`, 'SERVER_ERROR', response.status);
      }
      const result = (await response.json()) as Record<string, unknown>;

      if (result.error) break; // Unexpected error — return empty

      const taskResult = result.result as Record<string, unknown> | undefined;
      const task = taskResult?.task as Record<string, unknown> | undefined;
      const status = task?.status as Record<string, unknown> | undefined;
      const state = status?.state as string | undefined;

      if (state === 'completed' || state === 'failed') {
        return this.taskToProviderResponse(task, taskId, startMs);
      }

      await sleep(POLL_INTERVAL_MS);
    }

    throw new ProviderError('A2A task polling exhausted', 'TIMEOUT', undefined, { taskId });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createA2AClient(config: A2AClientConfig): A2AClient {
  return new A2AClient(config);
}
