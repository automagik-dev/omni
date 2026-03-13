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

/** Sanitize a string for use in file paths (team/agent names) */
function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

/** Sanitize team name for tmux window (dots are pane separators in tmux) */
function sanitizeWindowName(name: string): string {
  return name.replace(/\./g, '-');
}

/** Promisified execFile for async/await usage in auto-spawn logic */
function execFilePromise(file: string, args: string[], options?: { env?: NodeJS.ProcessEnv }): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options ?? {}, (error, stdout) => {
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
  /** Auto-spawn team-lead if team doesn't exist yet (default: true) */
  autoSpawn?: boolean;
  /** Working directory for auto-spawned team-lead (default: ~/workspace) */
  autoSpawnDir?: string;
  /** Tmux session name for auto-spawned team-leads (default: 'genie') */
  tmuxSession?: string;
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

  /** Auto-spawn team-lead when team doesn't exist */
  private readonly autoSpawn: boolean;
  private readonly autoSpawnDir: string;
  private readonly tmuxSession: string;

  /** Cache of teams known to exist (avoids repeated filesystem checks) */
  private readonly knownTeams = new Set<string>();
  /** Teams currently being spawned (prevents duplicate exec calls during bursts) */
  private readonly pendingTeams = new Set<string>();

  constructor(config: GenieClientConfig) {
    this.teamNameTemplate = config.teamName ?? 'genie';
    this.agentNameTemplate = config.agentName;
    this.targetAgentTemplate = config.targetAgent;
    this.autoSpawn = config.autoSpawn ?? true;
    this.autoSpawnDir = config.autoSpawnDir ?? join(homedir(), 'workspace');
    this.tmuxSession = config.tmuxSession ?? 'genie';

    this.hasTemplates =
      /\{\w+\}/.test(this.teamNameTemplate) ||
      /\{\w+\}/.test(this.agentNameTemplate) ||
      /\{\w+\}/.test(this.targetAgentTemplate);
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
   * Fire-and-forget: ensure team-lead exists for the given team.
   *
   * Checks BOTH config.json AND a running tmux window — a config without
   * a running session is considered broken (previous spawn may have failed
   * e.g. when called from PM2 without tmux context).
   *
   * Spawn strategy:
   * 1. Try `genie team ensure` with --tmux-session flag + GENIE_TMUX_SESSION env
   * 2. Verify tmux window actually exists after spawn
   * 3. If genie fails or window not found, fall back to direct tmux commands
   *
   * Uses pendingTeams set to coalesce concurrent requests for the same team,
   * preventing process storms during traffic bursts.
   */
  private ensureTeamExists(teamName: string): void {
    if (!this.autoSpawn) return;
    if (this.knownTeams.has(teamName)) return;
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
   * Check if team is fully active (config + tmux window) and spawn if not.
   */
  private async checkAndSpawnTeam(teamName: string): Promise<void> {
    const configPath = join(homedir(), '.claude', 'teams', teamName, 'config.json');
    const configExists = await stat(configPath)
      .then(() => true)
      .catch(() => false);

    if (configExists) {
      const windowActive = await this.hasTmuxWindow(teamName);
      if (windowActive) {
        this.knownTeams.add(teamName);
        this.pendingTeams.delete(teamName);
        return;
      }
      log.info('Team config exists but no tmux window — re-spawning', { teamName });
    }

    await this.spawnTeamLead(teamName);
  }

  /**
   * Check if a tmux window exists for the team in the target session.
   */
  private async hasTmuxWindow(teamName: string): Promise<boolean> {
    try {
      const stdout = await execFilePromise('tmux', ['list-windows', '-t', this.tmuxSession, '-F', '#{window_name}']);
      const windows = stdout.trim().split('\n');
      const windowName = sanitizeWindowName(teamName);
      return windows.some((w) => w === teamName || w === windowName);
    } catch {
      return false;
    }
  }

  /**
   * Spawn a team-lead via genie CLI (primary) with direct tmux fallback.
   */
  private async spawnTeamLead(teamName: string): Promise<void> {
    const args = ['team', 'ensure', teamName, '--dir', this.autoSpawnDir];
    const env = { ...process.env, GENIE_TMUX_SESSION: this.tmuxSession };

    log.info('Auto-spawning team-lead', { teamName, tmuxSession: this.tmuxSession, args });

    try {
      await execFilePromise('genie', args, { env });

      // Verify tmux window was actually created
      const active = await this.hasTmuxWindow(teamName);
      if (active) {
        log.info('Auto-spawn succeeded (tmux window verified)', { teamName });
        this.knownTeams.add(teamName);
        this.pendingTeams.delete(teamName);
        return;
      }
      log.warn('genie created config but tmux window not found, falling back to direct spawn', { teamName });
    } catch (genieError) {
      log.warn('genie team ensure failed, falling back to direct tmux spawn', {
        teamName,
        error: genieError instanceof Error ? genieError.message : String(genieError),
      });
    }

    // Fallback: spawn directly via tmux
    try {
      await this.spawnViaTmux(teamName);
    } catch (tmuxError) {
      log.error('Direct tmux spawn also failed', {
        teamName,
        error: tmuxError instanceof Error ? tmuxError.message : String(tmuxError),
      });
      this.pendingTeams.delete(teamName);
    }
  }

  /**
   * Direct tmux fallback: create session/window and launch Claude Code.
   * Used when genie CLI is unavailable or fails to create the tmux window
   * (e.g. called from PM2 without tmux env context).
   */
  private async spawnViaTmux(teamName: string): Promise<void> {
    const session = this.tmuxSession;
    const windowName = sanitizeWindowName(teamName);
    const target = `${session}:${windowName}`;

    // Ensure tmux session exists
    try {
      await execFilePromise('tmux', ['has-session', '-t', session]);
    } catch {
      await execFilePromise('tmux', ['new-session', '-d', '-s', session]);
    }

    // Create window (skip if already exists)
    if (!(await this.hasTmuxWindow(teamName))) {
      await execFilePromise('tmux', ['new-window', '-t', session, '-n', windowName, '-d', '-c', this.autoSpawnDir]);
    }

    // Launch Claude Code with team env vars
    const sanitized = sanitize(teamName);
    const claudeCmd = [
      `GENIE_TEAM='${sanitized}'`,
      "GENIE_AGENT_NAME='team-lead'",
      'CLAUDECODE=1',
      'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1',
      'claude',
      `--team-name '${sanitized}'`,
      "--agent-name 'team-lead'",
      `--agent-id 'team-lead@${sanitized}'`,
      '--dangerously-skip-permissions',
    ].join(' ');

    await execFilePromise('tmux', ['send-keys', '-t', target, claudeCmd, 'Enter']);

    log.info('Direct tmux spawn succeeded', { teamName, session, window: windowName });
    this.knownTeams.add(teamName);
    this.pendingTeams.delete(teamName);
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

    // Auto-spawn team-lead if team doesn't exist yet (fire-and-forget)
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
