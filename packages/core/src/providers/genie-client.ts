/**
 * Genie Client — writes to Claude Code's native team inbox
 *
 * Fire-and-forget: appends a message to ~/.claude/teams/<team>/inboxes/<agent>.json
 * The agent receives it natively and replies via omni send.
 * No outbox, no polling.
 */

import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../logger';
import { ProviderError } from './types';
import type { AgentHealthResult, IAgentClient, ProviderRequest, ProviderResponse, StreamChunk } from './types';

const log = createLogger('providers:genie-client');

export interface GenieClientConfig {
  /** Claude Code team name (default: 'genie') */
  teamName?: string;
  /** This agent's identity in the team (used as 'from' field) */
  agentName: string;
  /** Target agent to deliver messages to (which inbox to write) */
  targetAgent: string;
}

/** Claude Code native team inbox message format */
interface TeamInboxMessage {
  from: string;
  text: string;
  summary: string;
  timestamp: string;
  read: boolean;
}

export class GenieClient implements IAgentClient {
  private readonly teamName: string;
  private readonly agentName: string;
  private readonly targetAgent: string;
  private readonly inboxDir: string;
  private readonly inboxPath: string;

  constructor(config: GenieClientConfig) {
    this.teamName = (config.teamName ?? 'genie').replace(/[^a-zA-Z0-9_-]/g, '');
    this.agentName = config.agentName.replace(/[^a-zA-Z0-9_-]/g, '');
    this.targetAgent = config.targetAgent.replace(/[^a-zA-Z0-9_-]/g, '');
    this.inboxDir = join(homedir(), '.claude', 'teams', this.teamName, 'inboxes');
    this.inboxPath = join(this.inboxDir, `${this.targetAgent}.json`);
  }

  /**
   * Fire-and-forget: append message to agent's team inbox.
   * Returns immediately — the agent replies independently via omni send.
   */
  async run(request: ProviderRequest): Promise<ProviderResponse> {
    const startMs = Date.now();

    // Build the message text with context
    const parts: string[] = [];
    if (request.platform) {
      parts.push(`[channel:${request.platform.channel}]`);
      parts.push(`[instance:${request.platform.instanceId}]`);
    }
    if (request.chat?.id) {
      parts.push(`[chat:${request.chat.id}]`);
    }
    if (request.sender?.displayName) {
      parts.push(`[from:${request.sender.displayName}]`);
    }
    parts.push(request.message);

    // Priority instruction: agent must reply before doing anything else
    parts.push(
      `\n⚡ REPLY NOW via SendMessage to "${this.agentName}". Do not proceed with other tasks until you respond.`,
    );

    const text = parts.join(' ');
    const summary = request.message.length > 50 ? `${request.message.substring(0, 50)}...` : request.message;

    const inboxMessage: TeamInboxMessage = {
      from: this.agentName,
      text,
      summary,
      timestamp: new Date().toISOString(),
      read: false,
    };

    // Ensure inbox directory exists
    await mkdir(this.inboxDir, { recursive: true });

    // Locked read-modify-write to prevent concurrent message loss
    const lockPath = `${this.inboxPath}.lock`;
    let lockFd: Awaited<ReturnType<typeof open>> | null = null;
    try {
      lockFd = await open(lockPath, 'wx');
    } catch {
      // Lock exists — wait briefly and retry once
      await new Promise((r) => setTimeout(r, 100));
      try {
        lockFd = await open(lockPath, 'wx');
      } catch (error) {
        // Still couldn't acquire lock, fail to prevent data loss
        log.error('Could not acquire inbox lock after retry, aborting message delivery', { lockPath, error });
        throw new ProviderError('Failed to acquire lock on team inbox, message not delivered', 'SERVER_ERROR');
      }
    }

    try {
      // Read existing inbox, append, write back
      let inbox: TeamInboxMessage[] = [];
      try {
        const data = await readFile(this.inboxPath, 'utf-8');
        inbox = JSON.parse(data);
        if (!Array.isArray(inbox)) inbox = [];
      } catch {
        // File doesn't exist or invalid — start fresh
        inbox = [];
      }

      inbox.push(inboxMessage);

      // Atomic write
      const tmpPath = `${this.inboxPath}.tmp`;
      await writeFile(tmpPath, JSON.stringify(inbox, null, 2), 'utf-8');
      await rename(tmpPath, this.inboxPath);
    } finally {
      // Release lock
      if (lockFd) {
        await lockFd.close();
        try {
          await unlink(lockPath);
        } catch {}
      }
    }

    const durationMs = Date.now() - startMs;

    log.info('Message delivered to team inbox', {
      agent: this.agentName,
      team: this.teamName,
      messageLength: text.length,
      durationMs,
    });

    // Fire-and-forget: return empty content (agent replies independently)
    return {
      content: '',
      runId: `genie-${this.agentName}-${Date.now()}`,
      sessionId: request.sessionId ?? '',
      status: 'completed',
      metrics: {
        inputTokens: 0,
        outputTokens: 0,
        durationMs,
      },
    };
  }

  // biome-ignore lint/correctness/useYield: throws immediately, no streaming support
  async *stream(_request: ProviderRequest): AsyncGenerator<StreamChunk> {
    throw new ProviderError('Genie client does not support streaming', 'STREAM_ERROR');
  }

  async checkHealth(): Promise<AgentHealthResult> {
    const startMs = Date.now();

    try {
      // Check team directory exists
      const teamDir = join(homedir(), '.claude', 'teams', this.teamName);
      try {
        await stat(teamDir);
      } catch {
        return {
          healthy: false,
          latencyMs: Date.now() - startMs,
          error: `Team directory does not exist: ${teamDir}`,
        };
      }

      // Check inbox directory exists
      try {
        await stat(this.inboxDir);
      } catch {
        return {
          healthy: false,
          latencyMs: Date.now() - startMs,
          error: `Inbox directory does not exist: ${this.inboxDir}`,
        };
      }

      return {
        healthy: true,
        latencyMs: Date.now() - startMs,
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - startMs,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export function createGenieClient(config: GenieClientConfig): GenieClient {
  return new GenieClient(config);
}
