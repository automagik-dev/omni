/**
 * Claude Code Agent Client
 *
 * Implements IAgentClient using the @anthropic-ai/claude-agent-sdk.
 * Each client instance is bound to a project folder via `projectPath`.
 * The agent spawns rooted there, loading CLAUDE.md and .claude/ config.
 */

import { createLogger } from '../logger';
import type {
  AgentHealthResult,
  IAgentClient,
  ProviderRequest,
  ProviderResponse,
  StreamChunk,
  StreamDelta,
} from './types';

const log = createLogger('provider:claude-code');

/**
 * Configuration for a Claude Code provider instance.
 * Lives in `schemaConfig` JSON column when `schema = 'claude-code'`.
 */
export interface ClaudeCodeConfig {
  /** Path to the project folder — agent spawns rooted here.
   *  Reads CLAUDE.md, .claude/ config from this folder.
   *  All tools (Read, Bash, Glob) execute relative to this path. */
  projectPath: string;

  /** Anthropic API key (overrides ANTHROPIC_API_KEY env var) */
  apiKey?: string;

  /** Allowed tools (default: all tools) */
  allowedTools?: string[];

  /** Permission mode (default: bypassPermissions for server-side use) */
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

  /** Model override (default: uses Claude Code default) */
  model?: string;

  /** System prompt — prepended to Claude Code's own */
  systemPrompt?: string;

  /** MCP servers to connect (in addition to project's .claude config) */
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;

  /** Max turns per query (safety limit, default: 10) */
  maxTurns?: number;
}

/**
 * Streaming configuration — controls what's visible in streamed responses.
 */
export interface ClaudeCodeStreamConfig {
  /** Include tool calls in streamed output (default: false) */
  showToolCalls?: boolean;
  /** Include thinking in streamed output (default: false) */
  showThinking?: boolean;
  /** Include tool progress updates (default: false) */
  showToolProgress?: boolean;
  /** Tool call format: compact = "tool: preview", verbose = full args (default: 'compact') */
  toolCallFormat?: 'compact' | 'verbose';
}

/**
 * Metrics collected during a stream run.
 */
export interface StreamRunMetrics {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
}

/**
 * Result object from streamRun() — provides the async stream plus accessors
 * for session ID and metrics (available after the stream completes).
 */
export interface StreamRunResult {
  stream: AsyncGenerator<StreamDelta>;
  getSessionId(): string;
  getMetrics(): StreamRunMetrics | null;
}

/** Internal tracking for an in-progress tool_use content block. */
interface ToolBlock {
  id: string;
  name: string;
  inputJson: string;
}

/** Mutable state for the streaming accumulator, shared across handler functions. */
interface StreamAccumulator {
  content: string;
  thinking: string;
  thinkingStartMs: number;
  thinkingDurationMs: number | undefined;
  activeToolBlocks: Map<number, ToolBlock>;
  /** Tracks which block indices are active text blocks (to detect block completion) */
  activeTextBlockIndices: Set<number>;
}

/** Resolved stream config flags (pre-computed from ClaudeCodeStreamConfig). */
interface ResolvedStreamFlags {
  showToolCalls: boolean;
  showThinking: boolean;
  showToolProgress: boolean;
  toolCallFormat: 'compact' | 'verbose';
}

// ---------------------------------------------------------------------------
// Tool call formatting helpers
// ---------------------------------------------------------------------------

function getToolPreview(name: string, input: Record<string, unknown>): string {
  if (name === 'Bash' && input.command) return String(input.command).slice(0, 100);
  if ((name === 'Read' || name === 'Edit' || name === 'Write') && input.file_path) return String(input.file_path);
  if (name === 'Grep' && input.pattern) return String(input.pattern).slice(0, 60);
  if (name === 'Glob' && input.pattern) return String(input.pattern);
  if (name === 'WebFetch' && input.url) return String(input.url).slice(0, 80);
  if (name === 'WebSearch' && input.query) return String(input.query).slice(0, 80);
  if (name === 'Task' && input.description) return String(input.description).slice(0, 80);
  return '';
}

function formatToolCall(name: string, input: Record<string, unknown>, format: 'compact' | 'verbose'): string {
  if (format === 'verbose') {
    const args = Object.entries(input)
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 200) : JSON.stringify(v).slice(0, 200)}`)
      .join(', ');
    return `\n\u{1F527} ${name}(${args})\n`;
  }
  // compact
  const preview = getToolPreview(name, input);
  return preview ? `\n\u{1F527} ${name}: ${preview}\n` : `\n\u{1F527} ${name}\n`;
}

// ---------------------------------------------------------------------------
// StreamDelta helpers — freeze thinking and build cumulative content delta
// ---------------------------------------------------------------------------

/** Freeze thinking duration if not already frozen. */
function freezeThinking(acc: StreamAccumulator): void {
  if (acc.thinkingStartMs && acc.thinkingDurationMs === undefined) {
    acc.thinkingDurationMs = Date.now() - acc.thinkingStartMs;
  }
}

/** Build a cumulative content delta from the accumulator. */
function contentDelta(acc: StreamAccumulator): StreamDelta {
  return {
    phase: 'content',
    content: acc.content,
    thinking: acc.thinking || undefined,
    thinkingDurationMs: acc.thinkingDurationMs,
  };
}

// ---------------------------------------------------------------------------
// Stream event handlers (extracted for cognitive complexity)
// ---------------------------------------------------------------------------

/** Handle a content_block_start event. Returns a delta to yield, or null. */
function handleBlockStart(
  event: Record<string, unknown>,
  acc: StreamAccumulator,
  flags: ResolvedStreamFlags,
): StreamDelta | null {
  const block = event.content_block as Record<string, unknown> | undefined;
  const index = typeof event.index === 'number' ? event.index : -1;
  if (!block) return null;

  const blockType = block.type as string;

  if (blockType === 'thinking') {
    if (!acc.thinkingStartMs) acc.thinkingStartMs = Date.now();
  } else if (blockType === 'text') {
    acc.activeTextBlockIndices.add(index);
  } else if (blockType === 'tool_use' && flags.showToolCalls) {
    acc.activeToolBlocks.set(index, {
      id: (block.id as string) ?? '',
      name: (block.name as string) ?? 'unknown',
      inputJson: '',
    });
  }
  return null;
}

/** Handle a content_block_delta event. Returns a delta to yield, or null. */
function handleBlockDelta(
  event: Record<string, unknown>,
  acc: StreamAccumulator,
  flags: ResolvedStreamFlags,
): StreamDelta | null {
  const delta = event.delta as Record<string, unknown> | undefined;
  const index = typeof event.index === 'number' ? event.index : -1;
  if (!delta) return null;

  const deltaType = delta.type as string;

  if (deltaType === 'thinking_delta') {
    acc.thinking += (delta.thinking as string) ?? '';
    if (flags.showThinking && acc.thinkingStartMs) {
      return { phase: 'thinking', thinking: acc.thinking, thinkingElapsedMs: Date.now() - acc.thinkingStartMs };
    }
    return null;
  }

  if (deltaType === 'text_delta') {
    // Accumulate only — emit on content_block_stop to avoid mid-sentence sends
    acc.content += (delta.text as string) ?? '';
    freezeThinking(acc);
    return null;
  }

  if (deltaType === 'input_json_delta' && flags.showToolCalls) {
    const toolBlock = acc.activeToolBlocks.get(index);
    if (toolBlock) {
      toolBlock.inputJson += (delta.partial_json as string) ?? '';
    }
  }

  return null;
}

/** Handle a content_block_stop event. Returns a delta to yield, or null. */
function handleBlockStop(
  event: Record<string, unknown>,
  acc: StreamAccumulator,
  flags: ResolvedStreamFlags,
): StreamDelta | null {
  const index = typeof event.index === 'number' ? event.index : -1;

  // Text block completed — emit accumulated content as a delta
  if (acc.activeTextBlockIndices.has(index)) {
    acc.activeTextBlockIndices.delete(index);
    if (!acc.content) return null;
    return contentDelta(acc);
  }

  // Tool use block completed — append tool call annotation if enabled
  if (flags.showToolCalls) {
    const toolBlock = acc.activeToolBlocks.get(index);
    if (toolBlock) {
      acc.activeToolBlocks.delete(index);
      let input: Record<string, unknown> = {};
      try {
        input = toolBlock.inputJson ? (JSON.parse(toolBlock.inputJson) as Record<string, unknown>) : {};
      } catch {
        input = { _raw: toolBlock.inputJson };
      }
      acc.content += formatToolCall(toolBlock.name, input, flags.toolCallFormat);
      freezeThinking(acc);
      return contentDelta(acc);
    }
  }

  return null;
}

/** Route a stream_event message to the appropriate handler. Returns a delta to yield, or null. */
function handleStreamEvent(
  msg: Record<string, unknown>,
  acc: StreamAccumulator,
  flags: ResolvedStreamFlags,
): StreamDelta | null {
  const event = msg.event as Record<string, unknown> | undefined;
  if (!event) return null;

  const eventType = event.type as string;

  if (eventType === 'content_block_start') return handleBlockStart(event, acc, flags);
  if (eventType === 'content_block_delta') return handleBlockDelta(event, acc, flags);
  if (eventType === 'content_block_stop') return handleBlockStop(event, acc, flags);

  return null;
}

/** Handle a tool_progress message. Returns a delta to yield, or null. */
function handleToolProgress(msg: Record<string, unknown>, acc: StreamAccumulator): StreamDelta | null {
  const toolName = (msg.tool_name as string) ?? 'tool';
  const elapsed = (msg.elapsed_time_seconds as number) ?? 0;
  acc.content += `\n\u231B ${toolName} (${elapsed.toFixed(1)}s)...\n`;
  freezeThinking(acc);
  return contentDelta(acc);
}

/** Handle a tool_use_summary message. Returns a delta to yield, or null. */
function handleToolUseSummary(msg: Record<string, unknown>, acc: StreamAccumulator): StreamDelta | null {
  const summary = (msg.summary as string) ?? '';
  if (!summary) return null;
  acc.content += `\n${summary}\n`;
  freezeThinking(acc);
  return contentDelta(acc);
}

/** Outcome from processing a result message. */
type ResultOutcome =
  | { kind: 'success'; delta: StreamDelta; metrics: StreamRunMetrics; sessionId: string }
  | { kind: 'error'; delta: StreamDelta; metrics: StreamRunMetrics; sessionId: string };

/** Handle a result message. Always returns an outcome to yield + terminate. */
function handleResult(
  msg: Record<string, unknown>,
  acc: StreamAccumulator,
  startTime: number,
  currentSessionId: string,
): ResultOutcome {
  const durationMs = Date.now() - startTime;
  freezeThinking(acc);

  if (msg.subtype === 'success') {
    const resultContent = (msg.result as string) ?? '';
    const totalCost = (msg.total_cost_usd as number) ?? 0;
    const usage = (msg.usage as Record<string, number>) ?? {};
    const sid = (msg.session_id as string) ?? currentSessionId;

    return {
      kind: 'success',
      delta: {
        phase: 'final',
        content: resultContent || acc.content,
        thinking: acc.thinking || undefined,
        thinkingDurationMs: acc.thinkingDurationMs,
      },
      metrics: {
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        costUsd: totalCost,
        durationMs,
      },
      sessionId: sid,
    };
  }

  // Error result
  const errors = (msg.errors as string[]) ?? [];
  const errorContent = errors.join('\n') || `Agent error: ${msg.subtype}`;
  const sid = (msg.session_id as string) ?? currentSessionId;

  return {
    kind: 'error',
    delta: { phase: 'error', error: errorContent },
    metrics: { inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs },
    sessionId: sid,
  };
}

// ---------------------------------------------------------------------------
// Legacy StreamChunk helpers (unchanged)
// ---------------------------------------------------------------------------

/** Extract a StreamChunk from an SDK message, or null if not relevant */
function processStreamMessage(
  message: {
    type: string;
    subtype?: string;
    session_id?: string;
    message?: { content?: unknown };
    result?: string;
    errors?: string[];
  },
  _currentSessionId: string,
): StreamChunk | null {
  if (message.type === 'system' && message.subtype === 'init') {
    return { event: 'RunStarted', isComplete: false, sessionId: message.session_id };
  }

  if (message.type === 'assistant' && message.message?.content) {
    const blocks = message.message.content as Array<{ type: string; text?: string }>;
    const text = blocks
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('');
    if (text) {
      return { event: 'RunResponse', content: text, isComplete: false };
    }
  }

  if (message.type === 'result') {
    const fullContent = extractResultContent(message);
    return { event: 'RunCompleted', isComplete: true, fullContent, sessionId: message.session_id };
  }

  return null;
}

/** Extract content from a result message (success or error) */
function extractResultContent(message: { subtype?: string; result?: string; errors?: string[] }): string {
  if (message.subtype === 'success') return message.result ?? '';
  if (message.errors?.length) return message.errors.join('\n');
  return 'Agent error';
}

/** Accumulated state from iterating SDK messages in run() */
interface RunAccumulator {
  content: string;
  sessionId: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

/** Process a single SDK message during run(), returning a failed ProviderResponse for errors or null to continue */
function processRunMessage(
  message: {
    type: string;
    subtype?: string;
    session_id?: string;
    result?: string;
    errors?: string[];
    total_cost_usd?: number;
    usage?: { input_tokens?: number; output_tokens?: number };
  },
  acc: RunAccumulator,
  startTime: number,
): ProviderResponse | null {
  if (message.type === 'system' && message.subtype === 'init') {
    acc.sessionId = message.session_id ?? '';
    return null;
  }

  if (message.type !== 'result') return null;

  if (message.subtype === 'success') {
    acc.content = message.result ?? '';
    acc.costUsd = message.total_cost_usd ?? 0;
    acc.inputTokens = message.usage?.input_tokens ?? 0;
    acc.outputTokens = message.usage?.output_tokens ?? 0;
    return null;
  }

  // Error result — return early with failed response
  const errors = message.errors ?? [];
  const content = errors.join('\n') || `Agent error: ${message.subtype}`;
  log.error('Claude Code agent error', { subtype: message.subtype, errors, sessionId: acc.sessionId });

  return {
    content,
    runId: crypto.randomUUID(),
    sessionId: acc.sessionId,
    status: 'failed',
    metrics: { inputTokens: acc.inputTokens, outputTokens: acc.outputTokens, durationMs: Date.now() - startTime },
  };
}

// ---------------------------------------------------------------------------
// Client class
// ---------------------------------------------------------------------------

export class ClaudeCodeClient implements IAgentClient {
  constructor(private config: ClaudeCodeConfig) {}

  private buildOptions(
    request: ProviderRequest,
    opts?: { includePartialMessages?: boolean; abortSignal?: AbortSignal },
  ) {
    const options: Record<string, unknown> = {
      cwd: this.config.projectPath,
      settingSources: ['project'],
      permissionMode: this.config.permissionMode ?? 'bypassPermissions',
      maxTurns: this.config.maxTurns ?? 10,
    };

    // bypassPermissions requires this flag
    if (options.permissionMode === 'bypassPermissions') {
      options.allowDangerouslySkipPermissions = true;
    }

    if (this.config.allowedTools) {
      options.allowedTools = this.config.allowedTools;
    }
    if (this.config.model) {
      options.model = this.config.model;
    }
    if (this.config.systemPrompt) {
      options.systemPrompt = this.config.systemPrompt;
    }
    if (this.config.mcpServers) {
      options.mcpServers = this.config.mcpServers;
    }

    // Pass API key via env if provided (SDK reads ANTHROPIC_API_KEY)
    if (this.config.apiKey) {
      options.env = { ...process.env, ANTHROPIC_API_KEY: this.config.apiKey };
    }

    // Resume session if provided (must be a valid UUID — Claude Code SDK requires it)
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (request.sessionId && uuidPattern.test(request.sessionId)) {
      options.resume = request.sessionId;
    }

    // Enable partial messages for streaming (stream_event, tool_progress, etc.)
    if (opts?.includePartialMessages) {
      options.includePartialMessages = true;
    }

    // Wire up abort support via AbortController (SDK uses abortController option)
    if (opts?.abortSignal) {
      const controller = new AbortController();
      opts.abortSignal.addEventListener('abort', () => controller.abort(), { once: true });
      options.abortController = controller;
    }

    return options;
  }

  async run(request: ProviderRequest): Promise<ProviderResponse> {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const startTime = Date.now();
    const acc: RunAccumulator = { content: '', sessionId: '', costUsd: 0, inputTokens: 0, outputTokens: 0 };

    log.info('Running Claude Code agent', {
      projectPath: this.config.projectPath,
      sessionId: request.sessionId,
      model: this.config.model,
    });

    try {
      for await (const message of query({
        prompt: request.message,
        options: this.buildOptions(request),
      })) {
        const earlyReturn = processRunMessage(message, acc, startTime);
        if (earlyReturn) return earlyReturn;
      }
    } catch (error) {
      log.error('Claude Code agent threw', { error: String(error), sessionId: acc.sessionId });
      return {
        content: `Agent error: ${String(error)}`,
        runId: crypto.randomUUID(),
        sessionId: acc.sessionId,
        status: 'failed',
        metrics: { inputTokens: 0, outputTokens: 0, durationMs: Date.now() - startTime },
      };
    }

    const durationMs = Date.now() - startTime;

    log.info('Claude Code agent completed', {
      sessionId: acc.sessionId,
      durationMs,
      costUsd: acc.costUsd,
      inputTokens: acc.inputTokens,
      outputTokens: acc.outputTokens,
    });

    return {
      content: acc.content,
      runId: crypto.randomUUID(),
      sessionId: acc.sessionId,
      status: 'completed',
      metrics: { inputTokens: acc.inputTokens, outputTokens: acc.outputTokens, durationMs },
    };
  }

  /**
   * Stream run using the StreamDelta protocol (cumulative content).
   *
   * Iterates SDK messages with `includePartialMessages: true` to receive
   * `stream_event` (content_block_start/delta/stop), `tool_progress`, and
   * `tool_use_summary` messages in addition to the normal `result`.
   *
   * Returns a `StreamRunResult` which exposes the async generator plus
   * accessors for session ID and metrics (populated after the stream ends).
   */
  streamRun(
    request: ProviderRequest,
    streamConfig?: ClaudeCodeStreamConfig,
    abortSignal?: AbortSignal,
  ): StreamRunResult {
    let sessionId = '';
    let metrics: StreamRunMetrics | null = null;

    const self = this;
    const cfg = streamConfig ?? {};
    const flags: ResolvedStreamFlags = {
      showToolCalls: cfg.showToolCalls ?? false,
      showThinking: cfg.showThinking ?? false,
      showToolProgress: cfg.showToolProgress ?? false,
      toolCallFormat: cfg.toolCallFormat ?? 'compact',
    };

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Generator must handle SDK message loop, system init, result outcomes, and error recovery inline
    async function* generate(): AsyncGenerator<StreamDelta> {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      const startTime = Date.now();
      const acc: StreamAccumulator = {
        content: '',
        thinking: '',
        thinkingStartMs: 0,
        thinkingDurationMs: undefined,
        activeToolBlocks: new Map(),
        activeTextBlockIndices: new Set(),
      };

      log.info('streamRun: starting', {
        projectPath: self.config.projectPath,
        sessionId: request.sessionId,
        model: self.config.model,
        showToolCalls: flags.showToolCalls,
        showThinking: flags.showThinking,
        showToolProgress: flags.showToolProgress,
      });

      try {
        for await (const message of query({
          prompt: request.message,
          options: self.buildOptions(request, { includePartialMessages: true, abortSignal }),
        })) {
          if (abortSignal?.aborted) {
            yield { phase: 'error', error: 'Aborted' };
            return;
          }

          // Capture session ID from system init (before routing)
          const msg = message as Record<string, unknown>;

          // Debug: log every message type from SDK to diagnose streaming
          log.debug('streamRun: SDK message', {
            type: msg.type,
            subtype: msg.subtype,
            hasEvent: msg.type === 'stream_event' ? !!(msg as { event?: unknown }).event : undefined,
          });

          if (msg.type === 'system' && msg.subtype === 'init') {
            sessionId = (msg.session_id as string) ?? '';
            continue;
          }

          const delta = processStreamRunMessage(message, acc, flags, startTime, sessionId);
          if (!delta) continue;

          // Result outcomes carry metrics and session updates
          if ('kind' in delta) {
            sessionId = delta.sessionId;
            metrics = delta.metrics;
            log.info(`streamRun: ${delta.kind}`, { sessionId, durationMs: delta.metrics.durationMs });
            yield delta.delta;
            return;
          }

          yield delta;
        }

        // Loop ended without result — yield accumulated content as final
        if (acc.content) {
          freezeThinking(acc);
          metrics = { inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: Date.now() - startTime };
          yield {
            phase: 'final',
            content: acc.content,
            thinking: acc.thinking || undefined,
            thinkingDurationMs: acc.thinkingDurationMs,
          };
        }
      } catch (error) {
        if (abortSignal?.aborted) {
          yield { phase: 'error', error: 'Aborted' };
          return;
        }
        log.error('streamRun: threw', { error: String(error), sessionId });
        yield { phase: 'error', error: `Agent error: ${String(error)}` };
      }
    }

    return {
      stream: generate(),
      getSessionId: () => sessionId,
      getMetrics: () => metrics,
    };
  }

  async *stream(request: ProviderRequest): AsyncGenerator<StreamChunk> {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    let sessionId = '';

    log.info('Streaming Claude Code agent', {
      projectPath: this.config.projectPath,
      sessionId: request.sessionId,
    });

    try {
      for await (const message of query({
        prompt: request.message,
        options: this.buildOptions(request),
      })) {
        const chunk = processStreamMessage(message, sessionId);
        if (chunk) {
          if (chunk.sessionId) sessionId = chunk.sessionId;
          yield chunk;
        }
      }
    } catch (error) {
      log.error('Claude Code stream error', { error: String(error), sessionId });
      yield {
        event: 'RunCompleted',
        isComplete: true,
        fullContent: `Agent error: ${String(error)}`,
        sessionId,
      };
    }
  }

  async checkHealth(): Promise<AgentHealthResult> {
    const start = Date.now();
    try {
      const fs = await import('node:fs/promises');
      await fs.access(this.config.projectPath);

      const hasClaude = await fs
        .access(`${this.config.projectPath}/CLAUDE.md`)
        .then(() => true)
        .catch(() => false);

      return {
        healthy: true,
        latencyMs: Date.now() - start,
        ...(hasClaude ? {} : { error: 'No CLAUDE.md found (agent will still work but without project context)' }),
      };
    } catch {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: `Project path not accessible: ${this.config.projectPath}`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Top-level message router for streamRun (extracted for complexity)
// ---------------------------------------------------------------------------

/** Route a single SDK message during streamRun. Returns a StreamDelta, ResultOutcome, or null. */
function processStreamRunMessage(
  message: unknown,
  acc: StreamAccumulator,
  flags: ResolvedStreamFlags,
  startTime: number,
  currentSessionId: string,
): StreamDelta | ResultOutcome | null {
  const msg = message as Record<string, unknown>;

  if (msg.type === 'system' && msg.subtype === 'init') {
    // Session ID is captured by the caller via ResultOutcome, but init is handled inline
    return null;
  }

  if (msg.type === 'stream_event') {
    return handleStreamEvent(msg, acc, flags);
  }

  if (msg.type === 'tool_progress' && flags.showToolProgress) {
    return handleToolProgress(msg, acc);
  }

  if (msg.type === 'tool_use_summary' && flags.showToolCalls) {
    return handleToolUseSummary(msg, acc);
  }

  if (msg.type === 'result') {
    return handleResult(msg, acc, startTime, currentSessionId);
  }

  return null;
}

export function createClaudeCodeClient(config: ClaudeCodeConfig): ClaudeCodeClient {
  return new ClaudeCodeClient(config);
}
