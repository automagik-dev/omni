/**
 * AG-UI (CopilotKit) Agent Client
 *
 * Implements IAgentClient over the CopilotKit AG-UI SSE protocol.
 * Connects to CopilotKit endpoints and parses the 19-event AG-UI stream.
 *
 * Relevant SSE events:
 *   TEXT_MESSAGE_CONTENT → yield delta chunk
 *   RUN_FINISHED         → terminal (success)
 *   RUN_ERROR            → terminal (error)
 *   All others           → ignored (TOOL_CALL_*, STATE_SNAPSHOT, etc.)
 *
 * @see https://docs.copilotkit.ai/ag-ui
 */

import { ProviderError } from './types';
import type { IAgentClient, ProviderRequest, ProviderResponse, StreamChunk } from './types';

const DEFAULT_TIMEOUT_MS = 120_000;

// AG-UI event type constants
const AG_UI_TEXT_CONTENT = 'TEXT_MESSAGE_CONTENT';
const AG_UI_RUN_FINISHED = 'RUN_FINISHED';
const AG_UI_RUN_ERROR = 'RUN_ERROR';
const AG_UI_RUN_STARTED = 'RUN_STARTED';

export interface AgUiClientConfig {
  baseUrl: string;
  apiKey?: string;
  defaultTimeoutMs?: number;
}

interface AgUiEvent {
  type: string;
  delta?: string;
  messageId?: string;
  runId?: string;
  message?: string;
  [key: string]: unknown;
}

interface StreamAccumulation {
  content: string;
  runId: string;
  failed: boolean;
  failedMessage: string;
}

export class AgUiClient implements IAgentClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly defaultTimeoutMs: number;

  constructor(config: AgUiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // ─── IAgentClient ─────────────────────────────────────────────

  async run(request: ProviderRequest): Promise<ProviderResponse> {
    const startMs = Date.now();
    const result = await this.accumulateStream(request);

    if (result.failed) {
      throw new ProviderError(result.failedMessage, 'SERVER_ERROR');
    }

    return {
      content: result.content,
      runId: result.runId || `agui-${Date.now()}`,
      sessionId: request.sessionId ?? '',
      status: 'completed',
      metrics: {
        inputTokens: 0,
        outputTokens: 0,
        durationMs: Date.now() - startMs,
      },
    };
  }

  async *stream(request: ProviderRequest): AsyncGenerator<StreamChunk> {
    const controller = new AbortController();
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
        body: JSON.stringify(this.buildAgUiPayload(request)),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      throw new ProviderError(error instanceof Error ? error.message : 'Network error', 'NETWORK_ERROR');
    }

    if (!response.ok) {
      clearTimeout(timer);
      throw new ProviderError(
        `AG-UI request failed: ${response.status} ${response.statusText}`,
        'SERVER_ERROR',
        response.status,
      );
    }

    if (!response.body) {
      clearTimeout(timer);
      throw new ProviderError('No response body from AG-UI endpoint', 'INVALID_RESPONSE');
    }

    const decoder = new TextDecoder();
    let emittedFinal = false;
    try {
      for await (const chunk of this.readAgUiChunks(response.body as ReadableStream<Uint8Array>, decoder)) {
        yield chunk;
        if (chunk.isComplete) emittedFinal = true;
      }
    } finally {
      clearTimeout(timer);
    }

    // Stream ended without a terminal event — yield a fallback final chunk
    if (!emittedFinal) {
      yield { event: 'final', isComplete: true };
    }
  }

  async checkHealth(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      const response = await fetch(this.baseUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5_000),
      });
      return { healthy: response.status < 500, latencyMs: Date.now() - start };
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

  private buildAgUiPayload(request: ProviderRequest): unknown {
    return {
      threadId: request.sessionId ?? `thread-${Date.now()}`,
      runId: `run-${Date.now()}`,
      messages: [
        {
          id: `msg-${Date.now()}`,
          role: 'user',
          content: request.message,
          createdAt: Date.now(),
        },
      ],
      context: [],
      state: null,
      tools: [],
      // Forward platform metadata if available
      ...(request.platform
        ? {
            metadata: {
              instanceId: request.platform.instanceId,
              channelType: request.platform.channel,
              personId: request.userId,
            },
          }
        : {}),
    };
  }

  /** Accumulates a full stream into content/runId/error state. */
  private async accumulateStream(request: ProviderRequest): Promise<StreamAccumulation> {
    let content = '';
    let runId = '';
    let failed = false;
    let failedMessage = '';

    for await (const chunk of this.stream(request)) {
      if (chunk.runId) runId = chunk.runId;
      if (chunk.event === 'error') {
        failed = true;
        failedMessage = chunk.content ?? 'AG-UI run error';
      } else if (chunk.content && !chunk.isComplete) {
        content += chunk.content;
      }
    }

    return { content, runId, failed, failedMessage };
  }

  /** Reads the SSE stream and yields parsed AG-UI StreamChunks. */
  private async *readAgUiChunks(body: ReadableStream<Uint8Array>, decoder: TextDecoder): AsyncGenerator<StreamChunk> {
    const reader = body.getReader();
    let buffer = '';
    let runId = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        const result = this.processAgUiLines(lines, runId);
        runId = result.runId;
        for (const chunk of result.chunks) yield chunk;
        if (result.isComplete) return;
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** Processes a batch of SSE lines, returning parsed chunks and updated runId. */
  private processAgUiLines(
    lines: string[],
    runId: string,
  ): { chunks: StreamChunk[]; runId: string; isComplete: boolean } {
    const chunks: StreamChunk[] = [];
    let currentRunId = runId;
    for (const line of lines) {
      const chunk = this.parseAgUiLine(line, currentRunId);
      if (!chunk) continue;
      if (chunk.runId) currentRunId = chunk.runId;
      chunks.push(chunk);
      if (chunk.isComplete) return { chunks, runId: currentRunId, isComplete: true };
    }
    return { chunks, runId: currentRunId, isComplete: false };
  }

  /** Parses a single SSE data line into a StreamChunk or null. */
  private parseAgUiLine(line: string, currentRunId: string): StreamChunk | null {
    if (!line.startsWith('data: ')) return null;
    const data = line.slice(6).trim();
    if (!data || data === '[DONE]') return null;
    try {
      const event = JSON.parse(data) as AgUiEvent;
      return this.parseAgUiEvent(event, currentRunId);
    } catch {
      return null;
    }
  }

  private parseAgUiEvent(event: AgUiEvent, currentRunId: string): StreamChunk | null {
    switch (event.type) {
      case AG_UI_RUN_STARTED:
        return {
          event: 'start',
          isComplete: false,
          runId: (event.runId as string | undefined) ?? currentRunId,
        };

      case AG_UI_TEXT_CONTENT:
        if (!event.delta) return null;
        return {
          event: 'delta',
          content: event.delta as string,
          isComplete: false,
          runId: currentRunId,
        };

      case AG_UI_RUN_FINISHED:
        return {
          event: 'final',
          isComplete: true,
          runId: (event.runId as string | undefined) ?? currentRunId,
        };

      case AG_UI_RUN_ERROR:
        return {
          event: 'error',
          content: (event.message as string | undefined) ?? 'AG-UI run error',
          isComplete: true,
          runId: currentRunId,
        };

      default:
        // Ignore: TOOL_CALL_START, TOOL_CALL_CHUNK, TOOL_CALL_END,
        //         STATE_SNAPSHOT, STATE_DELTA, MESSAGES_SNAPSHOT, etc.
        return null;
    }
  }
}

export function createAgUiClient(config: AgUiClientConfig): AgUiClient {
  return new AgUiClient(config);
}
