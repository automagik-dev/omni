# Wish: Claude Code Agent Provider

> Use Claude Code (Agent SDK) as an agent provider in Omni

**Beads:** omni-v10
**Status:** draft
**Priority:** P2
**Depends on:** omni-q01 (Provider System Refactor)

---

## Problem

Omni needs an agent provider that goes beyond simple LLM chat. Claude Code provides **agentic capabilities** - file reading, code editing, web search, bash execution, MCP tool access - all configured per-project via `.claude/` directories.

The ideal UX: point the provider at a folder, and Claude Code uses that folder's config (CLAUDE.md, settings, MCP servers) to act as an agent.

## Goal

A `claude-code` provider schema that:
- Uses `@anthropic-ai/claude-agent-sdk` (TypeScript, in-process)
- Implements `IAgentClient` (from wish omni-q01)
- Configures via a project folder path (reads that folder's `.claude/` config)
- Supports streaming and sync modes
- Maps Claude Code sessions to Omni's session strategies

## Design

### Provider Config

```typescript
interface ClaudeCodeConfig {
  /** Path to the project folder whose .claude/ config to use */
  projectPath: string;

  /** Allowed tools (default: all read-only tools) */
  allowedTools?: string[];

  /** Permission mode */
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

  /** Model override (default: uses Claude Code default) */
  model?: string;

  /** System prompt prepended to Claude Code's own */
  systemPrompt?: string;

  /** MCP servers to connect (in addition to project's .claude config) */
  mcpServers?: Record<string, McpServerConfig>;

  /** Max turns per query (safety limit) */
  maxTurns?: number;
}
```

In the DB, this lives in `schemaConfig` JSON column when `schema = 'claude-code'`.

### Client Implementation

```typescript
// packages/core/src/providers/claude-code-client.ts

import { query } from '@anthropic-ai/claude-agent-sdk';

class ClaudeCodeClient implements IAgentClient {
  constructor(private config: ClaudeCodeConfig) {}

  async run(request: ProviderRequest): Promise<ProviderResponse> {
    const startTime = Date.now();
    let content = '';
    let sessionId = '';

    for await (const message of query({
      prompt: request.message,
      options: {
        cwd: this.config.projectPath,
        allowedTools: this.config.allowedTools,
        permissionMode: this.config.permissionMode ?? 'default',
        model: this.config.model,
        systemPrompt: this.config.systemPrompt,
        mcpServers: this.config.mcpServers,
        maxTurns: this.config.maxTurns ?? 10,
        // Resume session if provided
        ...(request.sessionId ? { resume: request.sessionId } : {}),
      },
    })) {
      // Capture session ID from init message
      if (message.type === 'system' && message.subtype === 'init') {
        sessionId = message.session_id;
      }
      // Collect result
      if (message.type === 'result') {
        content = message.result;
      }
    }

    return {
      content,
      runId: crypto.randomUUID(),
      sessionId,
      status: 'completed',
      metrics: { inputTokens: 0, outputTokens: 0, durationMs: Date.now() - startTime },
    };
  }

  async *stream(request: ProviderRequest): AsyncGenerator<StreamChunk> {
    let sessionId = '';

    for await (const message of query({
      prompt: request.message,
      options: {
        cwd: this.config.projectPath,
        allowedTools: this.config.allowedTools,
        permissionMode: this.config.permissionMode ?? 'default',
        model: this.config.model,
        systemPrompt: this.config.systemPrompt,
        mcpServers: this.config.mcpServers,
        maxTurns: this.config.maxTurns ?? 10,
        ...(request.sessionId ? { resume: request.sessionId } : {}),
      },
    })) {
      if (message.type === 'system' && message.subtype === 'init') {
        sessionId = message.session_id;
        yield { event: 'RunStarted', isComplete: false, sessionId };
      }

      if (message.type === 'assistant' && message.content) {
        // Extract text content from assistant message
        const text = message.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('');
        if (text) {
          yield { event: 'RunResponse', content: text, isComplete: false };
        }
      }

      if (message.type === 'result') {
        yield {
          event: 'RunCompleted',
          isComplete: true,
          fullContent: message.result,
          sessionId,
        };
      }
    }
  }

  async checkHealth(): Promise<AgentHealthResult> {
    const start = Date.now();
    try {
      // Verify the project path exists and has config
      const fs = await import('node:fs/promises');
      await fs.access(this.config.projectPath);
      return { healthy: true, latencyMs: Date.now() - start };
    } catch {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: `Project path not accessible: ${this.config.projectPath}`,
      };
    }
  }

  // discover() not applicable for Claude Code - it IS the agent
}
```

### Session Strategy Mapping

| Omni Strategy | Claude Code Behavior |
|---------------|---------------------|
| `per_user` | Store session ID per userId, resume on each call |
| `per_chat` | Store session ID per chatId, resume on each call |
| `per_user_per_chat` | Store session ID per userId:chatId, resume |

Claude Code's `resume` option with session IDs maps directly. We need a session store (in-memory Map or DB table) to track `strategyKey → claudeSessionId`.

### Factory Integration

```typescript
// In factory.ts
case 'claude-code':
  return createClaudeCodeClient(config.schemaConfig as ClaudeCodeConfig);
```

### What Claude Code Brings

Unlike a simple LLM API, Claude Code as a provider can:
- **Read project files** - understand codebase context
- **Execute commands** - run scripts, tests, builds
- **Use MCP tools** - connect to external services (databases, APIs)
- **Maintain conversation** - multi-turn sessions with full context
- **Follow project rules** - reads CLAUDE.md for project conventions

### Use Cases

1. **Code review agent** - point to repo, messages get reviewed with full context
2. **DevOps agent** - point to infra folder, handle deployment queries
3. **Documentation agent** - point to docs folder, answer questions with source
4. **Custom tool agent** - configure MCP servers for domain-specific tools

## Affected Files

### New Files
- `packages/core/src/providers/claude-code-client.ts` - Client implementation
- `packages/core/src/providers/__tests__/claude-code-client.test.ts` - Tests

### Modified Files
- `packages/core/src/providers/factory.ts` - Add claude-code case
- `packages/core/src/providers/types.ts` - Add ClaudeCodeConfig
- `packages/core/src/providers/index.ts` - Export new client
- `packages/core/src/types/agent.ts` - claude-code already in schemas (from wish 1)

### Package Dependencies
- `packages/core/package.json` - Add `@anthropic-ai/claude-agent-sdk`

## Execution Groups

### Group 1: SDK Integration + Client
1. Add `@anthropic-ai/claude-agent-sdk` dependency to core package
2. Verify bun compatibility (test import)
3. Implement `ClaudeCodeClient` with `run()`, `stream()`, `checkHealth()`
4. Session ID capture and resume logic

### Group 2: Factory + Session Store
1. Wire into provider factory
2. Implement session store (Map<strategyKey, sessionId>)
3. Integration with AgentRunnerService

### Group 3: Testing + Validation
1. Unit tests with mocked SDK
2. Integration test with real Claude Code (manual/CI)
3. Health check validation
4. Verify streaming works end-to-end

## Open Questions

1. **Session persistence** - In-memory Map loses sessions on restart. Do we need DB-backed session storage? (Probably yes for production, but Map is fine for v1)
2. **Cost/rate limiting** - Claude Code uses Anthropic API credits. Should the provider track usage?
3. **Timeout behavior** - Claude Code agent loops can run long. How to handle the `maxTurns` vs `timeoutMs` interplay?
4. **API key** - The `apiKey` field in DB maps to `ANTHROPIC_API_KEY` for Claude Code. Or does Claude Code use its own auth?

## Risks

- **Bun compatibility** - `@anthropic-ai/claude-agent-sdk` is built for Node.js. Need to verify it works under Bun
- **Long-running agents** - Claude Code can take minutes for complex tasks. May need async job pattern rather than request/response
- **File system access** - Claude Code needs filesystem access to the project path. Security implications in multi-tenant setups

## Non-Goals

- Building a UI for Claude Code config (use existing provider form with schemaConfig JSON)
- Implementing MCP server discovery
- Building a generic HTTP provider

## Success Criteria

- [ ] `schema = 'claude-code'` provider can be created via API
- [ ] Messages sent to a claude-code instance get processed by Claude Agent SDK
- [ ] Session continuity works (resume previous conversation)
- [ ] Streaming works end-to-end (message → agent → channel response)
- [ ] Health check validates project path exists
- [ ] All existing tests still pass
- [ ] `make check` passes
