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

  /** Build single-bracket metadata header from request context */
  private buildMetadataHeader(request: ProviderRequest): string {
    const tags: string[] = [];
    if (request.platform) {
      tags.push(`channel:${request.platform.channel}`);
      tags.push(`instance:${request.platform.instanceId}`);
    }
    if (request.chat?.id) tags.push(`chat:${request.chat.id}`);
    if (request.messageId) tags.push(`msg:${request.messageId}`);
    if (request.sender?.displayName) tags.push(`from:${request.sender.displayName}`);
    if (request.chat?.type) tags.push(`type:${request.chat.type}`);
    if (request.replyToMessageId) tags.push(`replyTo:${request.replyToMessageId}`);
    return tags.length > 0 ? `[${tags.join(' ')}]` : '';
  }

  /** Acquire file lock with stale lock recovery (30s threshold) */
  private async acquireLock(lockPath: string): Promise<Awaited<ReturnType<typeof open>>> {
    try {
      return await open(lockPath, 'wx');
    } catch {
      // Lock exists — wait briefly and retry once
      await new Promise((r) => setTimeout(r, 100));
    }

    try {
      return await open(lockPath, 'wx');
    } catch {
      // Still locked — check if stale from a crashed process
    }

    try {
      const lockStat = await stat(lockPath);
      const ageMs = Date.now() - lockStat.mtimeMs;
      if (ageMs > 30_000) {
        log.warn('Removing stale lock file', { lockPath, ageMs });
        await unlink(lockPath);
        return await open(lockPath, 'wx');
      }
      log.error('Lock file is fresh, another process is active', { lockPath, ageMs });
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      log.error('Could not recover from lock contention', { lockPath, error });
    }

    throw new ProviderError('Failed to acquire lock on team inbox, message not delivered', 'SERVER_ERROR');
  }

  /**
   * Fire-and-forget: append message to agent's team inbox.
   * Returns immediately — the agent replies independently via omni send.
   */
  async run(request: ProviderRequest): Promise<ProviderResponse> {
    const startMs = Date.now();

    const header = this.buildMetadataHeader(request);
    const replyInstruction = `⚡ REPLY NOW via SendMessage to "${this.agentName}". Do not proceed with other tasks until you respond.`;
    const text = header
      ? `${header}\n${request.message}\n${replyInstruction}`
      : `${request.message}\n${replyInstruction}`;
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
    const lockFd = await this.acquireLock(lockPath);

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
      await lockFd.close();
      try {
        await unlink(lockPath);
      } catch {}
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
