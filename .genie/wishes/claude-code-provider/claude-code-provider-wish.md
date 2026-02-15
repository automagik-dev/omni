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
- Configures via a **user-specified project folder path** — the agent spawns rooted in that folder
- Reads CLAUDE.md + `.claude/` config from the target folder automatically
- Supports streaming and sync modes
- Maps Claude Code sessions to Omni's session strategies

## SDK Version Decision

**Use V1 `query()` API** — not V2 preview.

### Validated Findings (Feb 2026)

| Feature | V1 `query()` | V2 `unstable_v2_*` |
|---------|---|---|
| `cwd` (tool execution in target folder) | Works | Works |
| `settingSources: ["project"]` (loads CLAUDE.md) | **Works** | **Does not load CLAUDE.md** |
| Session resume | Works via `resume` option | Works via `unstable_v2_resumeSession()` |
| Multi-turn | Requires input generator | Clean `send()`/`stream()` per turn |
| Result metadata | `{ result }` only | Rich: `total_cost_usd`, `usage`, `duration_ms`, `num_turns` |
| Bun compatible | Yes (tested v0.2.34, Bun 1.3.3) | Yes |
| Stability | Stable | Unstable preview, APIs may change |

**Critical**: The `cwd` + `settingSources: ["project"]` combination is what makes the agent "live" in the target folder. Without `settingSources`, the agent gets no project context (no CLAUDE.md, no `.claude/` config). V2 does not properly pass `settingSources` through yet, making it unsuitable.

### How `cwd` + `settingSources` Works

When both are set, Claude Code:
1. Sets tool execution root to `cwd` (Read, Bash, Glob, Grep all operate there)
2. Discovers and loads `CLAUDE.md` from `cwd` (and parent directories — recursive upward traversal)
3. Loads `.claude/settings.json`, `.claude/CLAUDE.md` from `cwd`
4. The agent behaves as if you ran `claude` from that directory

**Parent traversal note**: CLAUDE.md files in parent directories are also loaded. There's an [open issue (#149)](https://github.com/anthropics/claude-agent-sdk-typescript/issues/149) to add isolation. Not a blocker for us — just be aware.

---

> ### V2 SDK Watchlist
>
> The V2 API (`unstable_v2_*`) is cleaner for multi-turn conversations and provides
> richer result metadata (`total_cost_usd`, `usage` with token breakdown, `num_turns`,
> `duration_ms`). Monitor for:
>
> - **`settingSources` support** — currently broken in V2, blocks adoption
> - **Stabilization** — `unstable_v2_` prefix removal signals readiness
> - **Session forking** — not yet available in V2
>
> Once `settingSources` works in V2, migrate the client:
> - `run()` → `unstable_v2_prompt()` (one-liner, returns rich result object)
> - `stream()` → `session.send()` + `session.stream()`
> - Session resume → `unstable_v2_resumeSession(id)`
> - Metrics become free: `result.total_cost_usd`, `result.usage`, `result.num_turns`
>
> Track: https://github.com/anthropics/claude-agent-sdk-typescript/releases

---

## Design

### Provider Config

The key insight: `projectPath` is user-configured per provider. Each provider instance points to a specific folder on disk. The agent spawns rooted there.

```typescript
interface ClaudeCodeConfig {
  /** Path to the project folder — agent spawns rooted here.
   *  Reads CLAUDE.md, .claude/ config from this folder.
   *  All tools (Read, Bash, Glob) execute relative to this path. */
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

  /** Max turns per query (safety limit, default: 10) */
  maxTurns?: number;
}
```

In the DB, this lives in `schemaConfig` JSON column when `schema = 'claude-code'`.

**Example provider creation:**
```json
{
  "name": "personal-etl-agent",
  "schema": "claude-code",
  "baseUrl": "",
  "schemaConfig": {
    "projectPath": "/home/cezar/dev/personal-etl",
    "allowedTools": ["Read", "Glob", "Grep", "Bash"],
    "permissionMode": "bypassPermissions",
    "maxTurns": 10
  }
}
```

### Client Implementation

```typescript
// packages/core/src/providers/claude-code-client.ts

import { query } from '@anthropic-ai/claude-agent-sdk';

class ClaudeCodeClient implements IAgentClient {
  constructor(private config: ClaudeCodeConfig) {}

  private buildOptions(request: ProviderRequest) {
    return {
      cwd: this.config.projectPath,
      settingSources: ['project'] as const,  // CRITICAL: loads CLAUDE.md from projectPath
      allowedTools: this.config.allowedTools,
      permissionMode: this.config.permissionMode ?? 'default',
      model: this.config.model,
      systemPrompt: this.config.systemPrompt,
      mcpServers: this.config.mcpServers,
      maxTurns: this.config.maxTurns ?? 10,
      ...(request.sessionId ? { resume: request.sessionId } : {}),
    };
  }

  async run(request: ProviderRequest): Promise<ProviderResponse> {
    const startTime = Date.now();
    let content = '';
    let sessionId = '';

    for await (const message of query({
      prompt: request.message,
      options: this.buildOptions(request),
    })) {
      if (message.type === 'system' && message.subtype === 'init') {
        sessionId = message.session_id;
      }
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
      options: this.buildOptions(request),
    })) {
      if (message.type === 'system' && message.subtype === 'init') {
        sessionId = message.session_id;
        yield { event: 'RunStarted', isComplete: false, sessionId };
      }

      if (message.type === 'assistant' && message.content) {
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
      const fs = await import('node:fs/promises');
      // Verify project path exists
      await fs.access(this.config.projectPath);
      // Bonus: check if CLAUDE.md exists (nice to have, not required)
      const hasClaude = await fs.access(
        `${this.config.projectPath}/CLAUDE.md`
      ).then(() => true).catch(() => false);
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
- **Read project files** - understand codebase context via CLAUDE.md + file tools
- **Execute commands** - run scripts, tests, builds
- **Use MCP tools** - connect to external services (databases, APIs)
- **Maintain conversation** - multi-turn sessions with full context
- **Follow project rules** - reads CLAUDE.md for project conventions
- **Inherit project config** - `.claude/settings.json`, MCP servers, allowed tools

### Use Cases

1. **Code review agent** - point to repo, messages get reviewed with full context
2. **DevOps agent** - point to infra folder, handle deployment queries
3. **Documentation agent** - point to docs folder, answer questions with source
4. **Custom tool agent** - configure MCP servers for domain-specific tools
5. **Personal assistant** - point to personal-etl, query life data via Claude

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
2. Verify bun compatibility (already validated: v0.2.34 + Bun 1.3.3)
3. Implement `ClaudeCodeClient` with `run()`, `stream()`, `checkHealth()`
4. Ensure `cwd` + `settingSources: ["project"]` are always passed together
5. Session ID capture from `system.init` message and resume logic

### Group 2: Factory + Session Store
1. Wire into provider factory
2. Implement session store (Map<strategyKey, sessionId>)
3. Integration with AgentRunnerService

### Group 3: Testing + Validation
1. Unit tests with mocked SDK
2. Integration test with real project folder (e.g., point at omni-v2 itself)
3. Health check validation (path exists, CLAUDE.md present)
4. Verify streaming works end-to-end

## Open Questions

1. **Session persistence** - In-memory Map loses sessions on restart. Do we need DB-backed session storage? (Probably yes for production, but Map is fine for v1)
2. **Cost/rate limiting** - V2 result object provides `total_cost_usd` for free. V1 doesn't. Track when migrating to V2.
3. **Timeout behavior** - Claude Code agent loops can run long. How to handle the `maxTurns` vs `timeoutMs` interplay?
4. **API key** - The `apiKey` field in DB maps to `ANTHROPIC_API_KEY` for Claude Code. Or does Claude Code use its own auth?

## Risks

- ~~**Bun compatibility**~~ - **Validated**: works under Bun 1.3.3 with SDK v0.2.34
- **Long-running agents** - Claude Code can take minutes for complex tasks (test showed 47s for project analysis). May need async job pattern rather than request/response
- **File system access** - Claude Code needs filesystem access to the project path. Security implications in multi-tenant setups
- **Parent CLAUDE.md traversal** - Agent loads CLAUDE.md from parent directories too. No isolation option yet ([#149](https://github.com/anthropics/claude-agent-sdk-typescript/issues/149))

## Non-Goals

- Building a UI for Claude Code config (use existing provider form with schemaConfig JSON)
- Implementing MCP server discovery
- Building a generic HTTP provider
- V2 SDK migration (deferred until `settingSources` works)

## Success Criteria

- [ ] `schema = 'claude-code'` provider can be created via API
- [ ] Provider `schemaConfig.projectPath` controls where the agent operates
- [ ] Agent reads CLAUDE.md from the configured project folder
- [ ] Messages sent to a claude-code instance get processed by Claude Agent SDK
- [ ] Session continuity works (resume previous conversation)
- [ ] Streaming works end-to-end (message → agent → channel response)
- [ ] Health check validates project path exists
- [ ] All existing tests still pass
- [ ] `make check` passes

## Validation Test Scripts

Proof-of-concept scripts used during research (kept for reference):

- `/tmp/claude-code-sdk-test/test-sdk.ts` — V1 API validation (import, prompt, session, stream)
- `/tmp/claude-code-sdk-test/test-sdk-v2.ts` — V2 API validation (all 5 tests passed)
- `/tmp/claude-code-sdk-test/test-cwd-v1.ts` — **Key test**: V1 with `cwd` + `settingSources` pointed at a real project folder, successfully read CLAUDE.md and described the project
- `/tmp/claude-code-sdk-test/test-cwd.ts` — V2 equivalent (failed to load CLAUDE.md, confirming V2 limitation)
