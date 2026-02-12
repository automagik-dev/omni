/**
 * Claude Code Agent Client
 *
 * Implements IAgentClient using the @anthropic-ai/claude-agent-sdk.
 * Each client instance is bound to a project folder via `projectPath`.
 * The agent spawns rooted there, loading CLAUDE.md and .claude/ config.
 */

import { createLogger } from '../logger';
import type { AgentHealthResult, IAgentClient, ProviderRequest, ProviderResponse, StreamChunk } from './types';

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

export class ClaudeCodeClient implements IAgentClient {
  constructor(private config: ClaudeCodeConfig) {}

  private buildOptions(request: ProviderRequest) {
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

    // Resume session if provided
    if (request.sessionId) {
      options.resume = request.sessionId;
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

export function createClaudeCodeClient(config: ClaudeCodeConfig): ClaudeCodeClient {
  return new ClaudeCodeClient(config);
}
