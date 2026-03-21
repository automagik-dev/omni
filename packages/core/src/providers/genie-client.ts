/**
 * Genie Client — writes to Claude Code's native team inbox
 *
 * Fire-and-forget: appends a message to ~/.claude/teams/<team>/inboxes/<agent>.json
 * The agent receives it natively and replies via omni send.
 * No outbox, no polling.
 */

import { execFile } from 'node:child_process';
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../logger';
import { ProviderError } from './types';
import type { AgentHealthResult, IAgentClient, ProviderRequest, ProviderResponse, StreamChunk } from './types';

const log = createLogger('providers:genie-client');

/** Cache TTL in milliseconds (5 minutes) — expired entries trigger re-spawn via genie spawn (idempotent) */
const CACHE_TTL_MS = 5 * 60 * 1000;
/** Maximum entries in the knownTeams cache to prevent unbounded growth */
const CACHE_MAX_SIZE = 100;

/** Sanitize a string for use in file paths (team/agent names), stripping trailing dashes */
function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '').replace(/-+$/, '');
}

/** Promisified execFile for async/await usage in auto-spawn logic */
function execFilePromise(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, {}, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout));
    });
  });
}

export interface GenieClientConfig {
  /** Claude Code team name — supports template variables like "genie-{thread_id}" (default: 'genie') */
  teamName?: string;
  /** This agent's identity in the team (used as 'from' field) — supports template variables */
  agentName: string;
  /** Target agent to deliver messages to (which inbox to write) — supports template variables */
  targetAgent: string;
  /** Registered agent name in genie dir (e.g. "omni-pm", "cegonha") — used as spawn target */
  agentRole: string;
  /** Auto-spawn agent session if team doesn't exist yet (default: true) */
  autoSpawn?: boolean;
  /** Working directory for auto-spawned agent session (default: agent's registered dir via genie dir) */
  autoSpawnDir?: string;
}

/** Variables available for template interpolation at runtime */
export interface TemplateVars {
  thread_id?: string;
  chat_id?: string;
  sender_id?: string;
  channel?: string;
  instance_id?: string;
}

/**
 * Interpolate template variables in a string.
 * Replaces `{var_name}` with the corresponding value from vars.
 * Missing variables are replaced with empty string.
 */
export function interpolateTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = vars[key as keyof TemplateVars];
    return value ?? '';
  });
}

/** Extract template variables from a ProviderRequest */
function extractTemplateVars(request: ProviderRequest): TemplateVars {
  return {
    thread_id: request.chat?.threadId,
    chat_id: request.chat?.id,
    sender_id: request.userId,
    channel: request.platform?.channel,
    instance_id: request.platform?.instanceId,
  };
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
  /** Raw template values (may contain {var} placeholders) */
  private readonly teamNameTemplate: string;
  private readonly agentNameTemplate: string;
  private readonly targetAgentTemplate: string;

  /** Whether any config value contains template variables */
  private readonly hasTemplates: boolean;

  /** Auto-spawn agent session when team doesn't exist */
  private readonly autoSpawn: boolean;
  private readonly autoSpawnDir: string;
  /** Registered agent name in genie dir — used as spawn target */
  private readonly agentRole: string;

  /** Cache of teams known to exist — maps team name to timestamp for TTL expiry */
  private readonly knownTeams = new Map<string, number>();
  /** Teams currently being spawned (prevents duplicate exec calls during bursts) */
  private readonly pendingTeams = new Set<string>();

  constructor(config: GenieClientConfig) {
    this.teamNameTemplate = config.teamName ?? 'genie';
    this.agentNameTemplate = config.agentName;
    this.targetAgentTemplate = config.targetAgent;
    this.agentRole = config.agentRole;
    this.autoSpawn = config.autoSpawn ?? true;
    this.autoSpawnDir = config.autoSpawnDir ?? '';

    this.hasTemplates =
      /\{\w+\}/.test(this.teamNameTemplate) ||
      /\{\w+\}/.test(this.agentNameTemplate) ||
      /\{\w+\}/.test(this.targetAgentTemplate);
  }

  /** Check if a team is in the cache and not expired (TTL: 5 minutes) */
  private isTeamKnown(teamName: string): boolean {
    const cachedAt = this.knownTeams.get(teamName);
    if (cachedAt === undefined) return false;
    if (Date.now() - cachedAt > CACHE_TTL_MS) {
      this.knownTeams.delete(teamName);
      return false;
    }
    return true;
  }

  /** Mark a team as known with current timestamp, evicting oldest if at capacity */
  private markTeamKnown(teamName: string): void {
    if (this.knownTeams.size >= CACHE_MAX_SIZE && !this.knownTeams.has(teamName)) {
      const oldest = this.knownTeams.keys().next().value;
      if (oldest !== undefined) this.knownTeams.delete(oldest);
    }
    this.knownTeams.set(teamName, Date.now());
  }

  /** Resolve config values, interpolating templates if needed */
  private resolveConfig(request: ProviderRequest): {
    teamName: string;
    agentName: string;
    targetAgent: string;
    inboxDir: string;
    inboxPath: string;
  } {
    let teamName: string;
    let agentName: string;
    let targetAgent: string;

    if (this.hasTemplates) {
      const vars = extractTemplateVars(request);
      teamName = sanitize(interpolateTemplate(this.teamNameTemplate, vars));
      agentName = sanitize(interpolateTemplate(this.agentNameTemplate, vars));
      targetAgent = sanitize(interpolateTemplate(this.targetAgentTemplate, vars));
    } else {
      teamName = sanitize(this.teamNameTemplate);
      agentName = sanitize(this.agentNameTemplate);
      targetAgent = sanitize(this.targetAgentTemplate);
    }

    // Fail fast if template variables resolved to empty strings.
    // Without this, we'd write to paths like "inboxes/.json" or merge
    // unrelated conversations into the same inbox file.
    if (!teamName) {
      throw new ProviderError(
        `Team name resolved to empty string (template: "${this.teamNameTemplate}"). Ensure the template variable (e.g. {thread_id}) is populated in the request.`,
        'INVALID_RESPONSE',
      );
    }
    if (!agentName) {
      throw new ProviderError(
        `Agent name resolved to empty string (template: "${this.agentNameTemplate}"). Ensure the template variable is populated in the request.`,
        'INVALID_RESPONSE',
      );
    }
    if (!targetAgent) {
      throw new ProviderError(
        `Target agent resolved to empty string (template: "${this.targetAgentTemplate}"). Ensure the template variable is populated in the request.`,
        'INVALID_RESPONSE',
      );
    }

    const inboxDir = join(homedir(), '.claude', 'teams', teamName, 'inboxes');
    const inboxPath = join(inboxDir, `${targetAgent}.json`);

    return { teamName, agentName, targetAgent, inboxDir, inboxPath };
  }

  /**
   * Fire-and-forget: ensure agent session exists for the given team.
   *
   * Calls `genie spawn <agentRole> --team <teamName>` which is idempotent —
   * no-op if the session already exists (~2s cost max once per 5 min per team).
   *
   * Uses pendingTeams set to coalesce concurrent requests for the same team,
   * preventing process storms during traffic bursts.
   */
  private ensureTeamExists(teamName: string): void {
    if (!this.autoSpawn) return;
    if (this.isTeamKnown(teamName)) return;
    if (this.pendingTeams.has(teamName)) return; // Already checking/spawning

    this.pendingTeams.add(teamName);
    this.checkAndSpawnTeam(teamName).catch((error) => {
      log.warn('Auto-spawn failed', {
        teamName,
        error: error instanceof Error ? error.message : String(error),
      });
      this.pendingTeams.delete(teamName);
    });
  }

  /**
   * Spawn agent session for the team via genie CLI.
   * genie spawn is idempotent — no-op if session already exists.
   */
  private async checkAndSpawnTeam(teamName: string): Promise<void> {
    await this.spawnAgentSession(teamName);
  }

  /**
   * Spawn agent session via genie CLI.
   * Calls: genie spawn <agentRole> --team <teamName> [--cwd <autoSpawnDir>]
   */
  private async spawnAgentSession(teamName: string): Promise<void> {
    const args = ['spawn', this.agentRole, '--team', teamName];
    if (this.autoSpawnDir) {
      args.push('--cwd', this.autoSpawnDir);
    }

    log.info('Auto-spawning agent session', { teamName, agentRole: this.agentRole, args });

    try {
      await execFilePromise('genie', args);
      log.info('Agent session spawned successfully', { teamName });
      this.markTeamKnown(teamName);
    } catch (error) {
      log.warn('Agent session spawn failed', {
        teamName,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.pendingTeams.delete(teamName);
    }
  }

  /** Build single-bracket metadata header from request context (incoming message context) */
  private buildMetadataHeader(request: ProviderRequest): string {
    const tags: string[] = [];
    if (request.platform) {
      tags.push(`channel:${request.platform.channel}`);
      tags.push(`instance:${request.platform.instanceId}`);
    }
    if (request.chat?.id) tags.push(`chat:${request.chat.id}`);
    if (request.chat?.threadId) tags.push(`thread:${request.chat.threadId}`);
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

    const { teamName, agentName, targetAgent, inboxDir, inboxPath } = this.resolveConfig(request);

    const header = this.buildMetadataHeader(request);
    const replyInstruction = `⚡ REPLY NOW via SendMessage to "${agentName}". Include the routing header from the first line of this message in your reply. Do not proceed with other tasks until you respond.`;
    const text = header
      ? `${header}\n${request.message}\n${replyInstruction}`
      : `${request.message}\n${replyInstruction}`;
    const summary = request.message.length > 50 ? `${request.message.substring(0, 50)}...` : request.message;

    const inboxMessage: TeamInboxMessage = {
      from: agentName,
      text,
      summary,
      timestamp: new Date().toISOString(),
      read: false,
    };

    // Ensure inbox directory exists
    await mkdir(inboxDir, { recursive: true });

    // Locked read-modify-write to prevent concurrent message loss
    const lockPath = `${inboxPath}.lock`;
    const lockFd = await this.acquireLock(lockPath);

    try {
      // Read existing inbox, append, write back
      let inbox: TeamInboxMessage[] = [];
      try {
        const data = await readFile(inboxPath, 'utf-8');
        inbox = JSON.parse(data);
        if (!Array.isArray(inbox)) inbox = [];
      } catch {
        // File doesn't exist or invalid — start fresh
        inbox = [];
      }

      inbox.push(inboxMessage);

      // Atomic write
      const tmpPath = `${inboxPath}.tmp`;
      await writeFile(tmpPath, JSON.stringify(inbox, null, 2), 'utf-8');
      await rename(tmpPath, inboxPath);
    } finally {
      // Release lock
      await lockFd.close();
      try {
        await unlink(lockPath);
      } catch {}
    }

    // Auto-spawn agent session if team doesn't exist yet (fire-and-forget)
    this.ensureTeamExists(teamName);

    const durationMs = Date.now() - startMs;

    log.info('Message delivered to team inbox', {
      agent: agentName,
      team: teamName,
      target: targetAgent,
      messageLength: text.length,
      durationMs,
      hasTemplates: this.hasTemplates,
    });

    // Fire-and-forget: return empty content (agent replies independently)
    return {
      content: '',
      runId: `genie-${agentName}-${Date.now()}`,
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
      if (this.hasTemplates) {
        // Templated team names resolve to different directories per request
        // (e.g. "genie-{thread_id}" → "genie-123", "genie-456", ...).
        // We can't probe a specific team, so just verify the shared teams
        // root exists — if it does, the infrastructure is in place.
        const teamsRoot = join(homedir(), '.claude', 'teams');
        try {
          await stat(teamsRoot);
        } catch {
          return {
            healthy: false,
            latencyMs: Date.now() - startMs,
            error: `Teams root directory does not exist: ${teamsRoot}`,
          };
        }

        return {
          healthy: true,
          latencyMs: Date.now() - startMs,
        };
      }

      // Non-templated: probe the exact team directory and its inboxes
      const teamName = sanitize(this.teamNameTemplate);
      const teamDir = join(homedir(), '.claude', 'teams', teamName);
      const inboxDir = join(teamDir, 'inboxes');

      try {
        await stat(teamDir);
      } catch {
        return {
          healthy: false,
          latencyMs: Date.now() - startMs,
          error: `Team directory does not exist: ${teamDir}`,
        };
      }

      try {
        await stat(inboxDir);
      } catch {
        return {
          healthy: false,
          latencyMs: Date.now() - startMs,
          error: `Inbox directory does not exist: ${inboxDir}`,
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
