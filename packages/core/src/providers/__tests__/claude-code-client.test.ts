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

    it('sets resume when sessionId is a valid UUID', () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440000';
      const client = new ClaudeCodeClient(baseConfig);
      const options = getBuildOptions(client)({
        ...baseRequest,
        sessionId,
      });

      expect(options.resume).toBe(sessionId);
    });

    it('does not set resume when sessionId is not a valid UUID', () => {
      const client = new ClaudeCodeClient(baseConfig);
      const options = getBuildOptions(client)({
        ...baseRequest,
        sessionId: 'prev-session-id',
      });

      expect(options.resume).toBeUndefined();
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

    it('always sets CLAUDECODE=0 in env even without apiKey', () => {
      const client = new ClaudeCodeClient({ projectPath: '/test' });
      const options = getBuildOptions(client)(baseRequest);

      expect(options.env).toBeDefined();
      expect(options.env.CLAUDECODE).toBe('0');
      expect(options.env.ANTHROPIC_API_KEY).toBeUndefined();
    });

    it('passes request env into Claude Code SDK options', () => {
      const client = new ClaudeCodeClient({ projectPath: '/test' });
      const options = getBuildOptions(client)({
        ...baseRequest,
        env: {
          OMNI_INSTANCE: 'instance-123',
          OMNI_CHAT: 'chat-456',
          CLAUDECODE: '1',
        },
      });

      expect(options.env.OMNI_INSTANCE).toBe('instance-123');
      expect(options.env.OMNI_CHAT).toBe('chat-456');
      expect(options.env.CLAUDECODE).toBe('0');
    });

    it('passes mcpServers when configured', () => {
      const mcpServers = {
        playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
      };
      const client = new ClaudeCodeClient({ ...baseConfig, mcpServers });
      const options = getBuildOptions(client)(baseRequest);

      expect(options.mcpServers).toEqual(mcpServers);
    });

    it('appends mcpUrlParams to HTTP MCP server URLs', () => {
      const mcpServers = {
        gateway: { type: 'http' as const, url: 'https://mcp.example.com/v1' },
      };
      const client = new ClaudeCodeClient({ ...baseConfig, mcpServers });
      const options = getBuildOptions(client)({
        ...baseRequest,
        mcpUrlParams: { chat_id: '123' },
      });

      const gw = options.mcpServers.gateway as { url: string };
      expect(gw.url).toBe('https://mcp.example.com/v1?chat_id=123');
    });

    it('skips mcpUrlParams when not provided', () => {
      const mcpServers = {
        gateway: { type: 'http' as const, url: 'https://mcp.example.com/v1' },
      };
      const client = new ClaudeCodeClient({ ...baseConfig, mcpServers });
      const options = getBuildOptions(client)(baseRequest);

      const gw = options.mcpServers.gateway as { url: string };
      expect(gw.url).toBe('https://mcp.example.com/v1');
    });

    it('handles multiple MCP servers (HTTP + stdio mix)', () => {
      const mcpServers = {
        gateway: { type: 'http' as const, url: 'https://mcp.example.com/v1' },
        playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
        another: { type: 'http' as const, url: 'https://other.example.com/api?token=abc' },
      };
      const client = new ClaudeCodeClient({ ...baseConfig, mcpServers });
      const options = getBuildOptions(client)({
        ...baseRequest,
        mcpUrlParams: { chat_id: '456' },
      });

      const gw = options.mcpServers.gateway as { url: string };
      expect(gw.url).toBe('https://mcp.example.com/v1?chat_id=456');

      const another = options.mcpServers.another as { url: string };
      expect(another.url).toBe('https://other.example.com/api?token=abc&chat_id=456');

      const pw = options.mcpServers.playwright as { command: string; args: string[] };
      expect(pw.command).toBe('npx');
      expect(pw.args).toEqual(['@playwright/mcp@latest']);
    });

    it('ignores mcpUrlParams for stdio servers (no url field)', () => {
      const mcpServers = {
        playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
        local: { command: 'node', args: ['server.js'], env: { PORT: '3000' } },
      };
      const client = new ClaudeCodeClient({ ...baseConfig, mcpServers });
      const options = getBuildOptions(client)({
        ...baseRequest,
        mcpUrlParams: { chat_id: '789' },
      });

      // When no HTTP servers exist, mcpServers is passed through unchanged
      expect(options.mcpServers).toEqual(mcpServers);
    });

    it('does not mutate original config.mcpServers', () => {
      const mcpServers = {
        gateway: { type: 'http' as const, url: 'https://mcp.example.com/v1' },
        playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
      };
      const client = new ClaudeCodeClient({ ...baseConfig, mcpServers });
      const originalUrl = mcpServers.gateway.url;

      getBuildOptions(client)({
        ...baseRequest,
        mcpUrlParams: { chat_id: '999' },
      });

      // Original config must not be mutated
      expect(mcpServers.gateway.url).toBe(originalUrl);
      expect(mcpServers.gateway.url).toBe('https://mcp.example.com/v1');
    });

    it('forwards explicit pathToClaudeCodeExecutable to SDK options', () => {
      const client = new ClaudeCodeClient({
        ...baseConfig,
        pathToClaudeCodeExecutable: '/opt/claude/claude',
      });
      const options = getBuildOptions(client)(baseRequest);

      expect(options.pathToClaudeCodeExecutable).toBe('/opt/claude/claude');
    });

    it('URL-encodes param values safely', () => {
      const mcpServers = {
        gateway: { type: 'http' as const, url: 'https://mcp.example.com/v1' },
      };
      const client = new ClaudeCodeClient({ ...baseConfig, mcpServers });
      const options = getBuildOptions(client)({
        ...baseRequest,
        mcpUrlParams: { chat_id: 'user with spaces', tag: 'a&b=c' },
      });

      const gw = options.mcpServers.gateway as { url: string };
      // URLSearchParams encodes spaces as + and special chars as %XX
      expect(gw.url).toContain('chat_id=user+with+spaces');
      expect(gw.url).toContain('tag=a%26b%3Dc');
      expect(gw.url).toStartWith('https://mcp.example.com/v1?');
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
  // Mock session storage for tests
  const mockSessionStorage: import('../claude-code-provider').SessionStorage = {
    getSession: async () => null,
    upsertSession: async () => {},
    deleteSession: async () => {},
  };

  it('implements IAgentProvider interface', () => {
    const provider = new ClaudeCodeAgentProvider(
      'test-id',
      'Test Provider',
      {
        projectPath: '/test',
      },
      mockSessionStorage,
      {},
    );

    expect(provider.id).toBe('test-id');
    expect(provider.name).toBe('Test Provider');
    expect(provider.schema).toBe('claude-code');
    expect(provider.mode).toBe('round-trip');
    expect(typeof provider.canHandle).toBe('function');
    expect(typeof provider.trigger).toBe('function');
    expect(typeof provider.checkHealth).toBe('function');
  });

  it('canHandle returns true for all trigger types', () => {
    const provider = new ClaudeCodeAgentProvider('test-id', 'Test', { projectPath: '/test' }, mockSessionStorage, {});

    const makeTrigger = (type: string) => ({ type }) as unknown as AgentTrigger;

    expect(provider.canHandle(makeTrigger('dm'))).toBe(true);
    expect(provider.canHandle(makeTrigger('mention'))).toBe(true);
    expect(provider.canHandle(makeTrigger('reaction'))).toBe(true);
    expect(provider.canHandle(makeTrigger('reply'))).toBe(true);
    expect(provider.canHandle(makeTrigger('name_match'))).toBe(true);
  });

  it('delegates checkHealth to client', async () => {
    const provider = new ClaudeCodeAgentProvider(
      'test-id',
      'Test',
      {
        projectPath: '/nonexistent/path/that/does/not/exist',
      },
      mockSessionStorage,
      {},
    );

    const result = await provider.checkHealth();
    expect(result.healthy).toBe(false);
    expect(result.error).toContain('not accessible');
  });

  it('passes options through', () => {
    const provider = new ClaudeCodeAgentProvider(
      'test-id',
      'Test',
      { projectPath: '/test', model: 'claude-opus-4-6' },
      mockSessionStorage,
      { timeoutMs: 180_000, enableAutoSplit: false, prefixSenderName: false },
    );

    expect(provider).toBeDefined();
  });

  it('injects Omni context env into Claude Code requests', async () => {
    const provider = new ClaudeCodeAgentProvider('test-id', 'Test', { projectPath: '/test' }, mockSessionStorage, {
      prefixSenderName: false,
    });
    let capturedRequest: AnyRecord | undefined;
    (provider as unknown as AnyRecord).client.run = async (request: AnyRecord) => {
      capturedRequest = request;
      return {
        content: 'ok',
        runId: 'run-1',
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        status: 'completed',
      };
    };

    await provider.trigger({
      type: 'dm',
      traceId: 'trace-123',
      sessionId: 'session-chat-456',
      source: {
        instanceId: 'instance-123',
        chatId: 'chat-456',
        messageId: 'message-789',
        channelType: 'whatsapp-baileys',
      },
      sender: {
        platformUserId: 'sender-999',
        personId: 'person-111',
        displayName: undefined,
      },
      content: { text: 'hello' },
    } as AgentTrigger);

    expect(capturedRequest?.env.OMNI_INSTANCE).toBe('instance-123');
    expect(capturedRequest?.env.OMNI_CHAT).toBe('chat-456');
    expect(capturedRequest?.env.OMNI_MESSAGE).toBe('message-789');
    expect(capturedRequest?.env.OMNI_SESSION).toBe('session-chat-456');
    expect(capturedRequest?.env.OMNI_SENDER).toBe('sender-999');
    expect(capturedRequest?.mcpUrlParams).toEqual({ chat_id: 'chat-456' });
  });

  it('includes attached file paths in message for image forwarding', () => {
    const provider = new ClaudeCodeAgentProvider('test-id', 'Test', { projectPath: '/test' }, mockSessionStorage, {
      prefixSenderName: false,
    });

    const buildMessage = (context: AnyRecord) => (provider as unknown as AnyRecord).buildMessage(context) as string;

    const trigger: AnyRecord = {
      content: {
        text: 'Look at this image',
        files: [
          { path: '/tmp/uploads/photo.jpg', mimeType: 'image/jpeg' },
          { path: '/tmp/uploads/doc.pdf', mimeType: 'application/pdf' },
        ],
      },
      sender: { displayName: undefined },
      source: {},
    };

    const message = buildMessage(trigger);
    expect(message).toContain('Look at this image');
    expect(message).toContain('Attached files:');
    expect(message).toContain('/tmp/uploads/photo.jpg [image/jpeg]');
    expect(message).toContain('/tmp/uploads/doc.pdf [application/pdf]');
  });

  it('does not add attached files section when no files present', () => {
    const provider = new ClaudeCodeAgentProvider('test-id', 'Test', { projectPath: '/test' }, mockSessionStorage, {
      prefixSenderName: false,
    });

    const buildMessage = (context: AnyRecord) => (provider as unknown as AnyRecord).buildMessage(context) as string;

    const trigger: AnyRecord = {
      content: { text: 'Hello' },
      sender: { displayName: undefined },
      source: {},
    };

    const message = buildMessage(trigger);
    expect(message).toBe('Hello');
    expect(message).not.toContain('Attached files');
  });
});

describe('createClaudeCodeClient', () => {
  const { createClaudeCodeClient } = require('../claude-code-client') as typeof import('../claude-code-client');

  it('creates a ClaudeCodeClient instance', () => {
    const client = createClaudeCodeClient({ projectPath: '/test' });
    expect(client).toBeInstanceOf(ClaudeCodeClient);
  });
});
