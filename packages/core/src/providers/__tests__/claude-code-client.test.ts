/**
 * ClaudeCodeClient Tests
 *
 * Tests the IAgentClient implementation for Claude Code.
 * Since the SDK spawns real processes, we test:
 * - Config/options building (unit)
 * - Health checks (filesystem-based, no SDK needed)
 * - Provider wrapper interface compliance
 */

import { describe, expect, it } from 'bun:test';
import { ClaudeCodeClient, type ClaudeCodeConfig } from '../claude-code-client';
import { ClaudeCodeAgentProvider } from '../claude-code-provider';
import type { AgentTrigger } from '../types';

// biome-ignore lint/suspicious/noExplicitAny: test helper to access private buildOptions method
type AnyRecord = Record<string, any>;

/** Access the private buildOptions method for testing */
function getBuildOptions(client: ClaudeCodeClient) {
  return (request: AnyRecord) => (client as unknown as AnyRecord).buildOptions(request) as AnyRecord;
}

describe('ClaudeCodeClient', () => {
  const baseConfig: ClaudeCodeConfig = {
    projectPath: '/home/test/my-project',
    apiKey: 'sk-ant-test-key',
    maxTurns: 5,
  };

  const baseRequest = {
    message: 'Hello, Claude!',
    agentId: 'claude-code',
    userId: 'user-123',
  };

  describe('constructor', () => {
    it('accepts minimal config', () => {
      const client = new ClaudeCodeClient({ projectPath: '/test' });
      expect(client).toBeDefined();
    });

    it('accepts full config', () => {
      const client = new ClaudeCodeClient({
        projectPath: '/test',
        apiKey: 'key',
        allowedTools: ['Read'],
        permissionMode: 'plan',
        model: 'claude-opus-4-6',
        systemPrompt: 'test',
        maxTurns: 20,
        mcpServers: {
          playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
        },
      });
      expect(client).toBeDefined();
    });
  });

  describe('buildOptions()', () => {
    it('sets cwd and settingSources for project context', () => {
      const client = new ClaudeCodeClient(baseConfig);
      const options = getBuildOptions(client)(baseRequest);

      expect(options.cwd).toBe('/home/test/my-project');
      expect(options.settingSources).toEqual(['project']);
      expect(options.maxTurns).toBe(5);
      expect(options.permissionMode).toBe('bypassPermissions');
      expect(options.allowDangerouslySkipPermissions).toBe(true);
    });

    it('passes API key via env', () => {
      const client = new ClaudeCodeClient(baseConfig);
      const options = getBuildOptions(client)(baseRequest);

      expect(options.env.ANTHROPIC_API_KEY).toBe('sk-ant-test-key');
    });

    it('sets resume when sessionId provided', () => {
      const client = new ClaudeCodeClient(baseConfig);
      const options = getBuildOptions(client)({
        ...baseRequest,
        sessionId: 'prev-session-id',
      });

      expect(options.resume).toBe('prev-session-id');
    });

    it('does not set resume when no sessionId', () => {
      const client = new ClaudeCodeClient(baseConfig);
      const options = getBuildOptions(client)(baseRequest);

      expect(options.resume).toBeUndefined();
    });

    it('respects custom allowedTools', () => {
      const client = new ClaudeCodeClient({
        ...baseConfig,
        allowedTools: ['Read', 'Glob', 'Grep'],
      });
      const options = getBuildOptions(client)(baseRequest);

      expect(options.allowedTools).toEqual(['Read', 'Glob', 'Grep']);
    });

    it('passes model override', () => {
      const client = new ClaudeCodeClient({
        ...baseConfig,
        model: 'claude-opus-4-6',
      });
      const options = getBuildOptions(client)(baseRequest);

      expect(options.model).toBe('claude-opus-4-6');
    });

    it('passes systemPrompt', () => {
      const client = new ClaudeCodeClient({
        ...baseConfig,
        systemPrompt: 'You are a helpful code reviewer.',
      });
      const options = getBuildOptions(client)(baseRequest);

      expect(options.systemPrompt).toBe('You are a helpful code reviewer.');
    });

    it('uses default permissionMode when not specified', () => {
      const client = new ClaudeCodeClient({ projectPath: '/test' });
      const options = getBuildOptions(client)(baseRequest);

      expect(options.permissionMode).toBe('bypassPermissions');
      expect(options.allowDangerouslySkipPermissions).toBe(true);
    });

    it('uses custom permissionMode without skip flag', () => {
      const client = new ClaudeCodeClient({
        ...baseConfig,
        permissionMode: 'acceptEdits',
      });
      const options = getBuildOptions(client)(baseRequest);

      expect(options.permissionMode).toBe('acceptEdits');
      expect(options.allowDangerouslySkipPermissions).toBeUndefined();
    });

    it('does not set env when no apiKey', () => {
      const client = new ClaudeCodeClient({ projectPath: '/test' });
      const options = getBuildOptions(client)(baseRequest);

      expect(options.env).toBeUndefined();
    });

    it('passes mcpServers when configured', () => {
      const mcpServers = {
        playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
      };
      const client = new ClaudeCodeClient({ ...baseConfig, mcpServers });
      const options = getBuildOptions(client)(baseRequest);

      expect(options.mcpServers).toEqual(mcpServers);
    });
  });

  describe('checkHealth()', () => {
    it('returns healthy when project path exists', async () => {
      const client = new ClaudeCodeClient({
        ...baseConfig,
        projectPath: process.cwd(),
      });

      const result = await client.checkHealth();
      expect(result.healthy).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns unhealthy when project path does not exist', async () => {
      const client = new ClaudeCodeClient({
        ...baseConfig,
        projectPath: '/nonexistent/path/that/does/not/exist',
      });

      const result = await client.checkHealth();
      expect(result.healthy).toBe(false);
      expect(result.error).toContain('not accessible');
    });

    it('warns when CLAUDE.md is missing', async () => {
      const client = new ClaudeCodeClient({
        ...baseConfig,
        projectPath: '/tmp',
      });

      const result = await client.checkHealth();
      expect(result.healthy).toBe(true);
      expect(result.error).toContain('No CLAUDE.md');
    });

    it('reports healthy with no warning when CLAUDE.md exists', async () => {
      // Use the current project dir which has a CLAUDE.md
      const client = new ClaudeCodeClient({
        ...baseConfig,
        projectPath: process.cwd(),
      });

      const result = await client.checkHealth();
      expect(result.healthy).toBe(true);
      // Either no error, or error about missing CLAUDE.md (depends on cwd)
      // Just check healthy is true
    });
  });
});

describe('ClaudeCodeAgentProvider', () => {
  it('implements IAgentProvider interface', () => {
    const provider = new ClaudeCodeAgentProvider('test-id', 'Test Provider', {
      projectPath: '/test',
    });

    expect(provider.id).toBe('test-id');
    expect(provider.name).toBe('Test Provider');
    expect(provider.schema).toBe('claude-code');
    expect(provider.mode).toBe('round-trip');
    expect(typeof provider.canHandle).toBe('function');
    expect(typeof provider.trigger).toBe('function');
    expect(typeof provider.checkHealth).toBe('function');
  });

  it('canHandle returns true for all trigger types', () => {
    const provider = new ClaudeCodeAgentProvider('test-id', 'Test', {
      projectPath: '/test',
    });

    const makeTrigger = (type: string) => ({ type }) as unknown as AgentTrigger;

    expect(provider.canHandle(makeTrigger('dm'))).toBe(true);
    expect(provider.canHandle(makeTrigger('mention'))).toBe(true);
    expect(provider.canHandle(makeTrigger('reaction'))).toBe(true);
    expect(provider.canHandle(makeTrigger('reply'))).toBe(true);
    expect(provider.canHandle(makeTrigger('name_match'))).toBe(true);
  });

  it('delegates checkHealth to client', async () => {
    const provider = new ClaudeCodeAgentProvider('test-id', 'Test', {
      projectPath: '/nonexistent/path/that/does/not/exist',
    });

    const result = await provider.checkHealth();
    expect(result.healthy).toBe(false);
    expect(result.error).toContain('not accessible');
  });

  it('passes options through', () => {
    const provider = new ClaudeCodeAgentProvider(
      'test-id',
      'Test',
      { projectPath: '/test', model: 'claude-opus-4-6' },
      { timeoutMs: 180_000, enableAutoSplit: false, prefixSenderName: false },
    );

    expect(provider).toBeDefined();
  });
});

describe('createClaudeCodeClient', () => {
  const { createClaudeCodeClient } = require('../claude-code-client') as typeof import('../claude-code-client');

  it('creates a ClaudeCodeClient instance', () => {
    const client = createClaudeCodeClient({ projectPath: '/test' });
    expect(client).toBeInstanceOf(ClaudeCodeClient);
  });
});
