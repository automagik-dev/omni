/**
 * Tests for Hook Executor
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { executeHooks } from '../hooks/executor';
import { HookRegistry } from '../hooks/registry';
import type {
  BeforeAgentStartContext,
  BeforeMessageWriteContext,
  LLMInputContext,
  LLMOutputContext,
} from '../hooks/types';

describe('executeHooks', () => {
  let registry: HookRegistry;

  beforeEach(() => {
    registry = new HookRegistry();
  });

  describe('empty pipeline', () => {
    test('returns original context with no hooks', async () => {
      const context: LLMInputContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        senderId: 'user-1',
        messages: ['Hello'],
      };

      const result = await executeHooks('inst-1', 'llm_input', context, undefined, registry);

      expect(result.context).toEqual(context);
      expect(result.results).toHaveLength(0);
    });

    test('empty pipeline has minimal overhead', async () => {
      const context: LLMInputContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        senderId: 'user-1',
        messages: ['Hello'],
      };

      const start = performance.now();
      await executeHooks('inst-1', 'llm_input', context, undefined, registry);
      const durationMs = performance.now() - start;

      // Empty pipeline should be < 10ms
      expect(durationMs).toBeLessThan(10);
    });
  });

  describe('priority ordering', () => {
    test('executes hooks in priority order (ascending)', async () => {
      const order: string[] = [];

      registry.register('inst-1', {
        event: 'llm_input',
        handler: async () => {
          order.push('mid');
        },
        priority: 50,
      });
      registry.register('inst-1', {
        event: 'llm_input',
        handler: async () => {
          order.push('first');
        },
        priority: 10,
      });
      registry.register('inst-1', {
        event: 'llm_input',
        handler: async () => {
          order.push('last');
        },
        priority: 90,
      });

      const context: LLMInputContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        senderId: 'user-1',
        messages: ['Hello'],
      };

      await executeHooks('inst-1', 'llm_input', context, undefined, registry);

      expect(order).toEqual(['first', 'mid', 'last']);
    });
  });

  describe('read-only hooks (llm_input, llm_output)', () => {
    test('llm_input handler receives context but return is ignored', async () => {
      let receivedMessages: string[] = [];

      registry.register('inst-1', {
        event: 'llm_input',
        handler: async (ctx) => {
          receivedMessages = [...ctx.messages];
          // Return modified context — should be ignored for read-only hooks
          return { ...ctx, messages: ['Modified!'] };
        },
      });

      const context: LLMInputContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        senderId: 'user-1',
        messages: ['Original message'],
      };

      const result = await executeHooks('inst-1', 'llm_input', context, undefined, registry);

      // Handler received the context
      expect(receivedMessages).toEqual(['Original message']);
      // Original context unchanged (read-only)
      expect(result.context.messages).toEqual(['Original message']);
    });

    test('llm_output handler receives response and usage', async () => {
      let capturedResponse = '';
      let capturedUsage: Record<string, unknown> | undefined;

      registry.register('inst-1', {
        event: 'llm_output',
        handler: async (ctx) => {
          capturedResponse = ctx.response;
          capturedUsage = ctx.usage as Record<string, unknown> | undefined;
        },
      });

      const context: LLMOutputContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        response: 'Hello from AI!',
        usage: { inputTokens: 10, outputTokens: 5, durationMs: 200 },
      };

      await executeHooks('inst-1', 'llm_output', context, undefined, registry);

      expect(capturedResponse).toBe('Hello from AI!');
      expect(capturedUsage).toEqual({ inputTokens: 10, outputTokens: 5, durationMs: 200 });
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
  });

  describe('timeout enforcement', () => {
    test('skips hook that exceeds timeout', async () => {
      registry.register('inst-1', {
        event: 'llm_input',
        handler: async () => {
          // Simulate a slow hook
          await new Promise((resolve) => setTimeout(resolve, 500));
        },
        name: 'Slow Hook',
      });

      const context: LLMInputContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        senderId: 'user-1',
        messages: ['Hello'],
      };

      // Use a very short timeout to trigger timeout behavior
      const result = await executeHooks('inst-1', 'llm_input', context, { timeoutMs: 50 }, registry);

      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.status).toBe('timeout');
      expect(result.results[0]?.hookName).toBe('Slow Hook');
    });

    test('continues pipeline after timeout', async () => {
      const order: string[] = [];

      registry.register('inst-1', {
        event: 'llm_input',
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 500));
          order.push('slow');
        },
        priority: 10,
        name: 'Slow',
      });

      registry.register('inst-1', {
        event: 'llm_input',
        handler: async () => {
          order.push('fast');
        },
        priority: 20,
        name: 'Fast',
      });

      const context: LLMInputContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        senderId: 'user-1',
        messages: ['Hello'],
      };

      const result = await executeHooks('inst-1', 'llm_input', context, { timeoutMs: 50 }, registry);

      expect(result.results).toHaveLength(2);
      expect(result.results[0]?.status).toBe('timeout');
      expect(result.results[1]?.status).toBe('success');
      expect(order).toContain('fast');
    });
  });

  describe('error isolation', () => {
    test('catches and isolates hook errors', async () => {
      registry.register('inst-1', {
        event: 'llm_input',
        handler: async () => {
          throw new Error('Hook exploded!');
        },
        name: 'Bad Hook',
      });

      const context: LLMInputContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        senderId: 'user-1',
        messages: ['Hello'],
      };

      // Should NOT throw
      const result = await executeHooks('inst-1', 'llm_input', context, undefined, registry);

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
        event: 'llm_input',
        handler: async () => {
          throw 'string error';
        },
      });

      const context: LLMInputContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        senderId: 'user-1',
        messages: ['Hello'],
      };

      const result = await executeHooks('inst-1', 'llm_input', context, undefined, registry);

      expect(result.results[0]?.status).toBe('error');
      expect(result.results[0]?.error).toBe('string error');
    });
  });

  describe('execution results', () => {
    test('tracks duration for each hook', async () => {
      registry.register('inst-1', {
        event: 'llm_input',
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        },
      });

      const context: LLMInputContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        senderId: 'user-1',
        messages: ['Hello'],
      };

      const result = await executeHooks('inst-1', 'llm_input', context, undefined, registry);

      expect(result.results[0]?.durationMs).toBeGreaterThanOrEqual(5);
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(5);
    });

    test('reports all hook results', async () => {
      registry.register('inst-1', {
        event: 'llm_input',
        handler: async () => {},
        id: 'hook-1',
        name: 'First',
      });
      registry.register('inst-1', {
        event: 'llm_input',
        handler: async () => {},
        id: 'hook-2',
        name: 'Second',
      });

      const context: LLMInputContext = {
        instanceId: 'inst-1',
        chatId: 'chat-1',
        senderId: 'user-1',
        messages: ['Hello'],
      };

      const result = await executeHooks('inst-1', 'llm_input', context, undefined, registry);

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
