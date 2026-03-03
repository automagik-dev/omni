/**
 * Tests for Hook Executor
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { executeHooks } from '../hooks/executor';
import { HookRegistry } from '../hooks/registry';
import { DEFAULT_PIPELINE_TIMEOUT_MS } from '../hooks/types';
import type { BeforeAgentStartContext, BeforeMessageWriteContext } from '../hooks/types';

describe('executeHooks', () => {
  let registry: HookRegistry;

  beforeEach(() => {
    registry = new HookRegistry();
  });

  describe('empty pipeline', () => {
    test('returns original context with no hooks', async () => {
      const context: BeforeAgentStartContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        senderId: 'user-1',
      };

      const result = await executeHooks('inst-1', 'before_agent_start', context, undefined, registry);

      expect(result.context).toEqual(context);
      expect(result.results).toHaveLength(0);
    });

    test('empty pipeline has minimal overhead', async () => {
      const context: BeforeAgentStartContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        senderId: 'user-1',
      };

      const start = performance.now();
      await executeHooks('inst-1', 'before_agent_start', context, undefined, registry);
      const durationMs = performance.now() - start;

      // Empty pipeline should be < 10ms
      expect(durationMs).toBeLessThan(10);
    });
  });

  describe('priority ordering', () => {
    test('executes hooks in priority order (ascending)', async () => {
      const order: string[] = [];

      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async () => {
          order.push('mid');
        },
        priority: 50,
      });
      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async () => {
          order.push('first');
        },
        priority: 10,
      });
      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async () => {
          order.push('last');
        },
        priority: 90,
      });

      const context: BeforeMessageWriteContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        content: 'hello',
        direction: 'outbound',
      };

      await executeHooks('inst-1', 'before_message_write', context, undefined, registry);

      expect(order).toEqual(['first', 'mid', 'last']);
    });
  });

  describe('mutable hooks (before_agent_start, before_message_write)', () => {
    test('before_agent_start can override model selection', async () => {
      registry.register('inst-1', {
        event: 'before_agent_start',
        handler: async (ctx) => ({
          ...ctx,
          model: 'gpt-4o-mini',
          provider: 'openai',
        }),
      });

      const context: BeforeAgentStartContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        senderId: 'user-1',
        model: 'gpt-4o',
        provider: 'openai',
      };

      const result = await executeHooks('inst-1', 'before_agent_start', context, undefined, registry);

      expect(result.context.model).toBe('gpt-4o-mini');
      expect(result.context.provider).toBe('openai');
    });

    test('before_message_write can transform content', async () => {
      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async (ctx) => ({
          ...ctx,
          content: ctx.content.toUpperCase(),
        }),
      });

      const context: BeforeMessageWriteContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        content: 'hello world',
        direction: 'outbound',
      };

      const result = await executeHooks('inst-1', 'before_message_write', context, undefined, registry);

      expect(result.context.content).toBe('HELLO WORLD');
    });

    test('mutable hooks chain context through pipeline', async () => {
      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async (ctx) => ({
          ...ctx,
          content: `[PREFIX] ${ctx.content}`,
        }),
        priority: 10,
      });

      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async (ctx) => ({
          ...ctx,
          content: `${ctx.content} [SUFFIX]`,
        }),
        priority: 20,
      });

      const context: BeforeMessageWriteContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        content: 'message',
        direction: 'outbound',
      };

      const result = await executeHooks('inst-1', 'before_message_write', context, undefined, registry);

      expect(result.context.content).toBe('[PREFIX] message [SUFFIX]');
    });

    test('mutable hook returning void does not modify context', async () => {
      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async () => {
          // Observation-only, no return
        },
      });

      const context: BeforeMessageWriteContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        content: 'original',
        direction: 'outbound',
      };

      const result = await executeHooks('inst-1', 'before_message_write', context, undefined, registry);

      expect(result.context.content).toBe('original');
    });

    test('before_agent_start receives extended dispatcher context fields', async () => {
      let receivedCtx: BeforeAgentStartContext | undefined;

      registry.register('inst-1', {
        event: 'before_agent_start',
        handler: async (ctx) => {
          receivedCtx = ctx;
        },
      });

      const context: BeforeAgentStartContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        senderId: 'user-1',
        triggerType: 'webhook',
        traceId: 'trace-abc',
        correlationId: 'corr-123',
        files: [{ name: 'doc.pdf' }],
      };

      await executeHooks('inst-1', 'before_agent_start', context, undefined, registry);

      expect(receivedCtx?.triggerType).toBe('webhook');
      expect(receivedCtx?.traceId).toBe('trace-abc');
      expect(receivedCtx?.correlationId).toBe('corr-123');
      expect(receivedCtx?.files).toEqual([{ name: 'doc.pdf' }]);
    });
  });

  describe('Zod schema validation', () => {
    test('rejects hook return that violates schema', async () => {
      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async (ctx) => ({
          ...ctx,
          // content exceeds 100K limit
          content: 'x'.repeat(100_001),
        }),
        id: 'oversized',
      });

      const context: BeforeMessageWriteContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        content: 'original',
        direction: 'outbound',
      };

      const result = await executeHooks('inst-1', 'before_message_write', context, undefined, registry);

      expect(result.results[0]?.status).toBe('error');
      expect(result.results[0]?.error).toContain('invalid context');
      // Content should be unchanged (rejected update)
      expect(result.context.content).toBe('original');
    });

    test('metadata must use string values', async () => {
      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async (ctx) => ({ ...ctx, metadata: { key: 42 } }) as any,
        id: 'bad-metadata',
      });

      const context: BeforeMessageWriteContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        content: 'original',
        direction: 'outbound',
      };

      const result = await executeHooks('inst-1', 'before_message_write', context, undefined, registry);

      expect(result.results[0]?.status).toBe('error');
    });
  });

  describe('timeout enforcement', () => {
    test('skips hook that exceeds per-hook timeout', async () => {
      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 500));
        },
        name: 'Slow Hook',
      });

      const context: BeforeMessageWriteContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        content: 'hello',
        direction: 'outbound',
      };

      const result = await executeHooks('inst-1', 'before_message_write', context, { timeoutMs: 50 }, registry);

      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.status).toBe('timeout');
      expect(result.results[0]?.hookName).toBe('Slow Hook');
    });

    test('continues pipeline after per-hook timeout', async () => {
      const order: string[] = [];

      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 500));
          order.push('slow');
        },
        priority: 10,
        name: 'Slow',
      });

      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async (ctx) => {
          order.push('fast');
          return { ...ctx, content: 'from fast' };
        },
        priority: 20,
        name: 'Fast',
      });

      const context: BeforeMessageWriteContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        content: 'original',
        direction: 'outbound',
      };

      const result = await executeHooks('inst-1', 'before_message_write', context, { timeoutMs: 50 }, registry);

      expect(result.results).toHaveLength(2);
      expect(result.results[0]?.status).toBe('timeout');
      expect(result.results[1]?.status).toBe('success');
      expect(order).toContain('fast');
      expect(result.context.content).toBe('from fast');
    });

    test('pipeline respects global pipeline timeout budget', async () => {
      const executed: string[] = [];

      // Register many slow hooks — pipeline timeout should stop early
      for (let i = 0; i < 5; i++) {
        const idx = i;
        registry.register('inst-pipeline', {
          event: 'before_agent_start',
          handler: async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            executed.push(`hook-${idx}`);
          },
          priority: idx * 10,
          id: `slow-${i}`,
        });
      }

      const context: BeforeAgentStartContext = {
        instanceId: 'inst-pipeline',
        chatId: 'chat-1',
        senderId: 'user-1',
      };

      // Set pipeline timeout to 150ms — should allow ~1-2 hooks before cutting off
      const result = await executeHooks(
        'inst-pipeline',
        'before_agent_start',
        context,
        { timeoutMs: 200, pipelineTimeoutMs: 150 },
        registry,
      );

      // Should have fewer than 5 completed results due to pipeline timeout
      expect(result.results.length).toBeLessThan(5);
    });

    test('DEFAULT_PIPELINE_TIMEOUT_MS is 15000', () => {
      expect(DEFAULT_PIPELINE_TIMEOUT_MS).toBe(15_000);
    });
  });

  describe('error isolation', () => {
    test('catches and isolates hook errors', async () => {
      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async () => {
          throw new Error('Hook exploded!');
        },
        name: 'Bad Hook',
      });

      const context: BeforeMessageWriteContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        content: 'hello',
        direction: 'outbound',
      };

      // Should NOT throw
      const result = await executeHooks('inst-1', 'before_message_write', context, undefined, registry);

      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.status).toBe('error');
      expect(result.results[0]?.error).toBe('Hook exploded!');
    });

    test('continues pipeline after hook error', async () => {
      const executed: string[] = [];

      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async () => {
          throw new Error('Boom!');
        },
        priority: 10,
        id: 'bad',
      });

      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async (ctx) => {
          executed.push('good');
          return { ...ctx, content: 'modified' };
        },
        priority: 20,
        id: 'good',
      });

      const context: BeforeMessageWriteContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        content: 'original',
        direction: 'outbound',
      };

      const result = await executeHooks('inst-1', 'before_message_write', context, undefined, registry);

      expect(result.results).toHaveLength(2);
      expect(result.results[0]?.status).toBe('error');
      expect(result.results[1]?.status).toBe('success');
      expect(result.context.content).toBe('modified');
      expect(executed).toEqual(['good']);
    });

    test('handles non-Error throws', async () => {
      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async () => {
          throw 'string error';
        },
      });

      const context: BeforeMessageWriteContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        content: 'hello',
        direction: 'outbound',
      };

      const result = await executeHooks('inst-1', 'before_message_write', context, undefined, registry);

      expect(result.results[0]?.status).toBe('error');
      expect(result.results[0]?.error).toBe('string error');
    });
  });

  describe('execution results', () => {
    test('tracks duration for each hook', async () => {
      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        },
      });

      const context: BeforeMessageWriteContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        content: 'hello',
        direction: 'outbound',
      };

      const result = await executeHooks('inst-1', 'before_message_write', context, undefined, registry);

      expect(result.results[0]?.durationMs).toBeGreaterThanOrEqual(5);
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(5);
    });

    test('reports all hook results', async () => {
      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async () => {},
        id: 'hook-1',
        name: 'First',
      });
      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async () => {},
        id: 'hook-2',
        name: 'Second',
      });

      const context: BeforeMessageWriteContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        content: 'hello',
        direction: 'outbound',
      };

      const result = await executeHooks('inst-1', 'before_message_write', context, undefined, registry);

      expect(result.results).toHaveLength(2);
      expect(result.results[0]?.hookId).toBe('hook-1');
      expect(result.results[0]?.hookName).toBe('First');
      expect(result.results[1]?.hookId).toBe('hook-2');
      expect(result.results[1]?.hookName).toBe('Second');
    });
  });

  describe('synchronous handlers', () => {
    test('supports synchronous handler functions', async () => {
      registry.register('inst-1', {
        event: 'before_message_write',
        handler: (ctx) => ({
          ...ctx,
          content: 'sync modified',
        }),
      });

      const context: BeforeMessageWriteContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        content: 'original',
        direction: 'outbound',
      };

      const result = await executeHooks('inst-1', 'before_message_write', context, undefined, registry);

      expect(result.context.content).toBe('sync modified');
      expect(result.results[0]?.status).toBe('success');
    });
  });
});
