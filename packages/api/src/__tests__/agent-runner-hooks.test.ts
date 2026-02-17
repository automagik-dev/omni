/**
 * Integration tests for Agent Runner + Plugin Hooks
 *
 * Validates that hooks fire at correct pipeline stages and can modify
 * or observe context as specified by the plugin hook system.
 *
 * @see openclaw-plugin-hooks wish (Group B)
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { type LLMOutputContext, executeHooks, getHookRegistry, resetHookRegistry } from '@omni/core';

describe('Agent Runner Hook Integration', () => {
  beforeEach(() => {
    resetHookRegistry();
  });

  afterEach(() => {
    resetHookRegistry();
  });

  const instanceId = 'test-inst-1';
  const chatId = 'chat-1';
  const senderId = 'user-1';

  // ============================================================================
  // before_agent_start: Can change model selection
  // ============================================================================

  describe('before_agent_start hook', () => {
    test('can override model selection', async () => {
      const registry = getHookRegistry();
      registry.register(instanceId, {
        event: 'before_agent_start',
        handler: async (ctx) => ({
          ...ctx,
          model: 'gpt-4o-mini',
          provider: 'cheap-provider',
          agentId: 'mini-agent',
        }),
        priority: 10,
        name: 'Model Router',
      });

      const result = await executeHooks(instanceId, 'before_agent_start', {
        instanceId,
        chatId,
        senderId,
        model: 'gpt-4o',
        provider: 'expensive-provider',
        agentId: 'main-agent',
      });

      expect(result.context.model).toBe('gpt-4o-mini');
      expect(result.context.provider).toBe('cheap-provider');
      expect(result.context.agentId).toBe('mini-agent');
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.status).toBe('success');
    });

    test('chains multiple hooks in priority order', async () => {
      const registry = getHookRegistry();

      // First hook sets model
      registry.register(instanceId, {
        event: 'before_agent_start',
        handler: async (ctx) => ({
          ...ctx,
          model: 'gpt-4o-mini',
        }),
        priority: 10,
      });

      // Second hook sets provider
      registry.register(instanceId, {
        event: 'before_agent_start',
        handler: async (ctx) => ({
          ...ctx,
          provider: `provider-for-${ctx.model}`,
        }),
        priority: 20,
      });

      const result = await executeHooks(instanceId, 'before_agent_start', {
        instanceId,
        chatId,
        senderId,
        model: 'gpt-4o',
        provider: 'default',
      });

      // Second hook sees the model set by first hook
      expect(result.context.model).toBe('gpt-4o-mini');
      expect(result.context.provider).toBe('provider-for-gpt-4o-mini');
    });

    test('preserves context when hook returns void', async () => {
      const registry = getHookRegistry();
      registry.register(instanceId, {
        event: 'before_agent_start',
        handler: async () => {
          // Observation only, no return
        },
      });

      const result = await executeHooks(instanceId, 'before_agent_start', {
        instanceId,
        chatId,
        senderId,
        model: 'gpt-4o',
        provider: 'openai',
      });

      expect(result.context.model).toBe('gpt-4o');
      expect(result.context.provider).toBe('openai');
    });
  });

  // ============================================================================
  // llm_input: Receives full prompt messages array (read-only)
  // ============================================================================

  describe('llm_input hook', () => {
    test('receives full prompt messages array', async () => {
      const registry = getHookRegistry();
      let capturedMessages: string[] = [];

      registry.register(instanceId, {
        event: 'llm_input',
        handler: async (ctx) => {
          capturedMessages = [...ctx.messages];
        },
      });

      const messages = ['[User]: Hello', '[User]: How are you?'];
      await executeHooks(instanceId, 'llm_input', {
        instanceId,
        chatId,
        senderId,
        messages,
        model: 'gpt-4o',
        provider: 'openai',
      });

      expect(capturedMessages).toEqual(messages);
    });

    test('is read-only — modifications are ignored', async () => {
      const registry = getHookRegistry();

      registry.register(instanceId, {
        event: 'llm_input',
        handler: async (ctx) => {
          // Attempt to modify — should be ignored
          return { ...ctx, messages: ['HACKED'] };
        },
      });

      const originalMessages = ['Hello, world!'];
      const result = await executeHooks(instanceId, 'llm_input', {
        instanceId,
        chatId,
        senderId,
        messages: originalMessages,
      });

      // Original context unchanged
      expect(result.context.messages).toEqual(originalMessages);
    });

    test('receives model and provider info', async () => {
      const registry = getHookRegistry();
      let capturedModel: string | undefined;
      let capturedProvider: string | undefined;

      registry.register(instanceId, {
        event: 'llm_input',
        handler: async (ctx) => {
          capturedModel = ctx.model;
          capturedProvider = ctx.provider;
        },
      });

      await executeHooks(instanceId, 'llm_input', {
        instanceId,
        chatId,
        senderId,
        messages: ['test'],
        model: 'claude-3-opus',
        provider: 'anthropic',
      });

      expect(capturedModel).toBe('claude-3-opus');
      expect(capturedProvider).toBe('anthropic');
    });
  });

  // ============================================================================
  // llm_output: Receives model response with usage stats (read-only)
  // ============================================================================

  describe('llm_output hook', () => {
    test('receives model response and usage stats', async () => {
      const registry = getHookRegistry();
      let capturedResponse = '';
      let capturedUsage: LLMOutputContext['usage'];

      registry.register(instanceId, {
        event: 'llm_output',
        handler: async (ctx) => {
          capturedResponse = ctx.response;
          capturedUsage = ctx.usage;
        },
      });

      await executeHooks(instanceId, 'llm_output', {
        instanceId,
        chatId,
        response: 'Hello! I am an AI assistant.',
        usage: {
          inputTokens: 150,
          outputTokens: 25,
          durationMs: 1200,
        },
        model: 'gpt-4o',
        provider: 'openai',
      });

      expect(capturedResponse).toBe('Hello! I am an AI assistant.');
      expect(capturedUsage).toEqual({
        inputTokens: 150,
        outputTokens: 25,
        durationMs: 1200,
      });
    });

    test('is read-only — modifications are ignored', async () => {
      const registry = getHookRegistry();

      registry.register(instanceId, {
        event: 'llm_output',
        handler: async (ctx) => {
          return { ...ctx, response: 'TAMPERED' };
        },
      });

      const result = await executeHooks(instanceId, 'llm_output', {
        instanceId,
        chatId,
        response: 'Original response',
      });

      expect(result.context.response).toBe('Original response');
    });
  });

  // ============================================================================
  // before_message_write: Can modify message content before save
  // ============================================================================

  describe('before_message_write hook', () => {
    test('can transform message content', async () => {
      const registry = getHookRegistry();

      registry.register(instanceId, {
        event: 'before_message_write',
        handler: async (ctx) => ({
          ...ctx,
          content: ctx.content.replace(/bad word/gi, '***'),
        }),
        name: 'Content Filter',
      });

      const result = await executeHooks(instanceId, 'before_message_write', {
        instanceId,
        chatId,
        content: 'This has a bad word in it',
        direction: 'outbound',
      });

      expect(result.context.content).toBe('This has a *** in it');
    });

    test('receives direction (inbound/outbound)', async () => {
      const registry = getHookRegistry();
      let capturedDirection: string | undefined;

      registry.register(instanceId, {
        event: 'before_message_write',
        handler: async (ctx) => {
          capturedDirection = ctx.direction;
        },
      });

      await executeHooks(instanceId, 'before_message_write', {
        instanceId,
        chatId,
        content: 'test',
        direction: 'inbound',
      });

      expect(capturedDirection).toBe('inbound');
    });

    test('chains transformations through multiple hooks', async () => {
      const registry = getHookRegistry();

      registry.register(instanceId, {
        event: 'before_message_write',
        handler: async (ctx) => ({
          ...ctx,
          content: `[LOGGED] ${ctx.content}`,
        }),
        priority: 10,
      });

      registry.register(instanceId, {
        event: 'before_message_write',
        handler: async (ctx) => ({
          ...ctx,
          content: ctx.content.toUpperCase(),
        }),
        priority: 20,
      });

      const result = await executeHooks(instanceId, 'before_message_write', {
        instanceId,
        chatId,
        content: 'hello world',
        direction: 'outbound',
      });

      expect(result.context.content).toBe('[LOGGED] HELLO WORLD');
    });
  });

  // ============================================================================
  // Pipeline ordering: All hooks fire in correct order
  // ============================================================================

  describe('pipeline ordering', () => {
    test('hooks fire in correct pipeline order when simulating full run', async () => {
      const registry = getHookRegistry();
      const executionOrder: string[] = [];

      registry.register(instanceId, {
        event: 'before_agent_start',
        handler: async () => {
          executionOrder.push('before_agent_start');
        },
      });

      registry.register(instanceId, {
        event: 'llm_input',
        handler: async () => {
          executionOrder.push('llm_input');
        },
      });

      registry.register(instanceId, {
        event: 'llm_output',
        handler: async () => {
          executionOrder.push('llm_output');
        },
      });

      registry.register(instanceId, {
        event: 'before_message_write',
        handler: async () => {
          executionOrder.push('before_message_write');
        },
      });

      // Simulate the agent runner pipeline stages in order
      await executeHooks(instanceId, 'before_agent_start', {
        instanceId,
        chatId,
        senderId,
      });

      await executeHooks(instanceId, 'llm_input', {
        instanceId,
        chatId,
        senderId,
        messages: ['Hello'],
      });

      // [LLM API call would happen here]

      await executeHooks(instanceId, 'llm_output', {
        instanceId,
        chatId,
        response: 'Hi there!',
      });

      await executeHooks(instanceId, 'before_message_write', {
        instanceId,
        chatId,
        content: 'Hi there!',
        direction: 'outbound',
      });

      expect(executionOrder).toEqual(['before_agent_start', 'llm_input', 'llm_output', 'before_message_write']);
    });
  });

  // ============================================================================
  // No hooks registered: Existing behavior unchanged
  // ============================================================================

  describe('no hooks registered', () => {
    test('returns original context unchanged', async () => {
      // No hooks registered — pipeline should be a passthrough
      const startResult = await executeHooks(instanceId, 'before_agent_start', {
        instanceId,
        chatId,
        senderId,
        model: 'gpt-4o',
        provider: 'openai',
        agentId: 'agent-1',
      });

      expect(startResult.context.model).toBe('gpt-4o');
      expect(startResult.context.provider).toBe('openai');
      expect(startResult.results).toHaveLength(0);

      const writeResult = await executeHooks(instanceId, 'before_message_write', {
        instanceId,
        chatId,
        content: 'unchanged message',
        direction: 'outbound',
      });

      expect(writeResult.context.content).toBe('unchanged message');
      expect(writeResult.results).toHaveLength(0);
    });

    test('empty pipeline has minimal overhead', async () => {
      const start = performance.now();

      await executeHooks(instanceId, 'before_agent_start', {
        instanceId,
        chatId,
        senderId,
      });
      await executeHooks(instanceId, 'llm_input', {
        instanceId,
        chatId,
        senderId,
        messages: ['test'],
      });
      await executeHooks(instanceId, 'llm_output', {
        instanceId,
        chatId,
        response: 'test',
      });
      await executeHooks(instanceId, 'before_message_write', {
        instanceId,
        chatId,
        content: 'test',
        direction: 'outbound',
      });

      const totalMs = performance.now() - start;
      // All 4 empty hook pipelines should complete in <10ms total
      expect(totalMs).toBeLessThan(10);
    });
  });

  // ============================================================================
  // Instance isolation
  // ============================================================================

  describe('instance isolation', () => {
    test('hooks only fire for their registered instance', async () => {
      const registry = getHookRegistry();
      const inst1Calls: string[] = [];
      const inst2Calls: string[] = [];

      registry.register('inst-1', {
        event: 'llm_input',
        handler: async () => {
          inst1Calls.push('fired');
        },
      });

      registry.register('inst-2', {
        event: 'llm_input',
        handler: async () => {
          inst2Calls.push('fired');
        },
      });

      await executeHooks('inst-1', 'llm_input', {
        instanceId: 'inst-1',
        chatId,
        senderId,
        messages: ['test'],
      });

      expect(inst1Calls).toHaveLength(1);
      expect(inst2Calls).toHaveLength(0);
    });
  });

  // ============================================================================
  // Error resilience in pipeline
  // ============================================================================

  describe('error resilience', () => {
    test('failing hook does not block the pipeline', async () => {
      const registry = getHookRegistry();
      let goodHookFired = false;

      registry.register(instanceId, {
        event: 'before_message_write',
        handler: async () => {
          throw new Error('Hook crashed!');
        },
        priority: 10,
      });

      registry.register(instanceId, {
        event: 'before_message_write',
        handler: async (ctx) => {
          goodHookFired = true;
          return { ...ctx, content: 'transformed' };
        },
        priority: 20,
      });

      const result = await executeHooks(instanceId, 'before_message_write', {
        instanceId,
        chatId,
        content: 'original',
        direction: 'outbound',
      });

      expect(goodHookFired).toBe(true);
      expect(result.context.content).toBe('transformed');
      expect(result.results[0]?.status).toBe('error');
      expect(result.results[1]?.status).toBe('success');
    });
  });
});
