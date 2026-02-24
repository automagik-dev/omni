/**
 * Integration tests for agent-dispatcher hook helpers.
 *
 * The dispatcher helpers (executeBeforeAgentStartHooks, executeBeforeMessageWriteHooks)
 * are tested via the core executeHooks / HookRegistry infrastructure they delegate to.
 * We test the hook system end-to-end as it will behave inside the dispatcher.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { HookRegistry, executeHooks } from '@omni/core';
import type { BeforeAgentStartContext, BeforeMessageWriteContext } from '@omni/core';
import { MAX_HOOKS_PER_INSTANCE } from '@omni/core';

// ---------------------------------------------------------------------------
// Helpers that mirror the dispatcher's hook helper logic
// ---------------------------------------------------------------------------

async function runBeforeAgentStart(
  registry: HookRegistry,
  instanceId: string,
  chatId: string,
  senderId: string,
  triggerType: string,
  traceId: string,
): Promise<BeforeAgentStartContext | null> {
  const hookCount = registry.getHookCount(instanceId, 'before_agent_start');
  if (hookCount === 0) return null;

  const context: BeforeAgentStartContext = {
    instanceId,
    chatId,
    senderId,
    triggerType,
    traceId,
  };

  const result = await executeHooks(
    instanceId,
    'before_agent_start',
    context,
    { timeoutMs: 2000, pipelineTimeoutMs: 15_000 },
    registry,
  );
  return result.context;
}

async function runBeforeMessageWrite(
  registry: HookRegistry,
  instanceId: string,
  chatId: string,
  content: string,
): Promise<string> {
  const hookCount = registry.getHookCount(instanceId, 'before_message_write');
  if (hookCount === 0) return content;

  const context: BeforeMessageWriteContext = {
    instanceId,
    chatId,
    content,
    direction: 'outbound',
  };

  const result = await executeHooks(
    instanceId,
    'before_message_write',
    context,
    { timeoutMs: 2000, pipelineTimeoutMs: 15_000 },
    registry,
  );
  return result.context.content;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('agent-dispatcher hook helpers', () => {
  let registry: HookRegistry;

  beforeEach(() => {
    registry = new HookRegistry();
  });

  // Reset is local per test via fresh registry instance — no global side effects

  describe('empty registry passthrough', () => {
    test('before_agent_start returns null when no hooks registered', async () => {
      const result = await runBeforeAgentStart(registry, 'inst-1', 'chat-1', 'user-1', 'dm', 'trace-abc');
      expect(result).toBeNull();
    });

    test('before_message_write returns original content when no hooks registered', async () => {
      const result = await runBeforeMessageWrite(registry, 'inst-1', 'chat-1', 'Hello world');
      expect(result).toBe('Hello world');
    });
  });

  describe('before_agent_start context correctness', () => {
    test('fires with correct instanceId, chatId, senderId, triggerType, traceId', async () => {
      let capturedCtx: BeforeAgentStartContext | undefined;

      registry.register('inst-1', {
        event: 'before_agent_start',
        handler: async (ctx) => {
          capturedCtx = ctx;
        },
      });

      await runBeforeAgentStart(registry, 'inst-1', 'chat-abc', 'user-xyz', 'mention', 'trace-123');

      expect(capturedCtx).toBeDefined();
      expect(capturedCtx?.instanceId).toBe('inst-1');
      expect(capturedCtx?.chatId).toBe('chat-abc');
      expect(capturedCtx?.senderId).toBe('user-xyz');
      expect(capturedCtx?.triggerType).toBe('mention');
      expect(capturedCtx?.traceId).toBe('trace-123');
    });

    test('only fires for registered instance, not other instances', async () => {
      let fired = false;
      registry.register('inst-A', {
        event: 'before_agent_start',
        handler: async () => {
          fired = true;
        },
      });

      // Run for a different instance
      const result = await runBeforeAgentStart(registry, 'inst-B', 'chat-1', 'user-1', 'dm', 'trace-1');
      expect(result).toBeNull();
      expect(fired).toBe(false);
    });
  });

  describe('before_message_write content transform', () => {
    test('hook can transform content (uppercase example)', async () => {
      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async (ctx) => ({ ...ctx, content: ctx.content.toUpperCase() }),
      });

      const result = await runBeforeMessageWrite(registry, 'inst-1', 'chat-1', 'hello world');
      expect(result).toBe('HELLO WORLD');
    });

    test('hook returning void leaves content unchanged', async () => {
      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async () => {
          // intentionally return void
        },
      });

      const result = await runBeforeMessageWrite(registry, 'inst-1', 'chat-1', 'original text');
      expect(result).toBe('original text');
    });

    test('multiple hooks chain transforms in priority order', async () => {
      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async (ctx) => ({ ...ctx, content: `[prefix] ${ctx.content}` }),
        priority: 10,
      });
      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async (ctx) => ({ ...ctx, content: `${ctx.content} [suffix]` }),
        priority: 90,
      });

      const result = await runBeforeMessageWrite(registry, 'inst-1', 'chat-1', 'body');
      expect(result).toBe('[prefix] body [suffix]');
    });
  });

  describe('hook timeout does not block dispatch', () => {
    test('slow hook (>timeoutMs) resolves within ~timeoutMs + buffer', async () => {
      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async () => {
          // Simulate slow operation — 10 seconds
          await new Promise((resolve) => setTimeout(resolve, 10_000));
          return undefined;
        },
      });

      const start = performance.now();
      const result = await runBeforeMessageWrite(registry, 'inst-1', 'chat-1', 'original');
      const elapsed = performance.now() - start;

      // Should return original content (timeout, no mutation committed)
      expect(result).toBe('original');
      // Should complete within 3 seconds (2s timeout + overhead)
      expect(elapsed).toBeLessThan(3000);
    });
  });

  describe('hook error does not crash dispatch', () => {
    test('throwing hook is isolated — content returned unchanged', async () => {
      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async () => {
          throw new Error('hook exploded!');
        },
      });

      const result = await runBeforeMessageWrite(registry, 'inst-1', 'chat-1', 'safe content');
      expect(result).toBe('safe content');
    });

    test('throwing before_agent_start hook does not propagate', async () => {
      registry.register('inst-1', {
        event: 'before_agent_start',
        handler: async () => {
          throw new Error('start hook crash!');
        },
      });

      // Should not throw — hooks are error-isolated
      await expect(runBeforeAgentStart(registry, 'inst-1', 'chat-1', 'user-1', 'dm', 'trace-1')).resolves.toBeDefined();
    });
  });

  describe('hook count cap enforcement', () => {
    test(`register throws when ${MAX_HOOKS_PER_INSTANCE} hooks are already registered`, () => {
      for (let i = 0; i < MAX_HOOKS_PER_INSTANCE; i++) {
        registry.register('inst-cap', {
          event: 'before_agent_start',
          handler: async () => {},
          id: `hook-${i}`,
        });
      }

      expect(() =>
        registry.register('inst-cap', {
          event: 'before_agent_start',
          handler: async () => {},
        }),
      ).toThrow(`Hook registration limit exceeded for instance inst-cap (max: ${MAX_HOOKS_PER_INSTANCE})`);
    });
  });
});
