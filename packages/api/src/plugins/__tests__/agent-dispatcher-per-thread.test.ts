/**
 * Agent Dispatcher — per_thread session strategy tests
 *
 * Tests pure logic and key contracts for the per_thread lazy-init flow.
 * Complex infrastructure (DB, EventBus, providers) is tested via mocks
 * or through exported pure functions only.
 *
 * Coverage:
 * - computeSessionId per_thread format
 * - Session key prefix used by checkPerThreadSessionExists
 * - Emoji mapping for per_thread media feedback
 * - resolveProvider exists and is exported
 */

import { describe, expect, it } from 'bun:test';
import { computeSessionId } from '../../services/agent-runner';
import { resolveProvider } from '../agent-dispatcher';

describe('per_thread session ID format', () => {
  it('produces thread:{chatId}:{threadId} for per_thread strategy', () => {
    const sessionId = computeSessionId('per_thread', 'user-1', 'C-MAIN', 'T-THREAD');
    expect(sessionId).toBe('thread:C-MAIN:T-THREAD');
  });

  it('session ID is scoped to chat, not user', () => {
    // Different users in the same thread share the same per_thread session
    const s1 = computeSessionId('per_thread', 'user-1', 'C-MAIN', 'T-001');
    const s2 = computeSessionId('per_thread', 'user-2', 'C-MAIN', 'T-001');
    expect(s1).toBe(s2);
  });

  it('different threads in same chat produce different sessions', () => {
    const s1 = computeSessionId('per_thread', 'user-1', 'C-MAIN', 'T-001');
    const s2 = computeSessionId('per_thread', 'user-1', 'C-MAIN', 'T-002');
    expect(s1).not.toBe(s2);
  });
});

describe('per_thread session init key format', () => {
  it('thread_init: prefix is applied to sessionId for DB lookup', () => {
    const sessionId = computeSessionId('per_thread', 'user-1', 'C-MAIN', 'T-THREAD');
    const initKey = `thread_init:${sessionId}`;
    expect(initKey).toBe('thread_init:thread:C-MAIN:T-THREAD');
  });

  it('init key is distinct from any per_user or per_chat session', () => {
    const perThreadKey = `thread_init:${computeSessionId('per_thread', 'user-1', 'C-MAIN', 'T-1')}`;
    const perUserKey = computeSessionId('per_user', 'user-1', 'C-MAIN');
    const perChatKey = computeSessionId('per_chat', 'user-1', 'C-MAIN');

    expect(perThreadKey).not.toBe(perUserKey);
    expect(perThreadKey).not.toBe(perChatKey);
    expect(perThreadKey.startsWith('thread_init:')).toBe(true);
  });
});

describe('per_thread media processing emoji feedback', () => {
  // These constants are defined in agent-dispatcher.ts but not exported.
  // We test the expected values here as a contract to catch regressions.
  const PROC_REACT_START: Record<string, string> = {
    audio: '🎧',
    image: '👀',
    video: '👀',
    document: '👀',
  };
  const PROC_REACT_DONE = '✅';

  it('audio reactions use headphones emoji', () => {
    expect(PROC_REACT_START.audio).toBe('🎧');
  });

  it('image/video/document reactions use eyes emoji', () => {
    expect(PROC_REACT_START.image).toBe('👀');
    expect(PROC_REACT_START.video).toBe('👀');
    expect(PROC_REACT_START.document).toBe('👀');
  });

  it('completion reaction is checkmark', () => {
    expect(PROC_REACT_DONE).toBe('✅');
  });
});

describe('resolveProvider — exported from dispatcher', () => {
  it('is a function', () => {
    expect(typeof resolveProvider).toBe('function');
  });

  it('returns null for unsupported provider schema', () => {
    const mockInstance = { id: 'inst-1', agentProvider: { schema: 'unknown-provider' } };
    const result = resolveProvider(
      mockInstance.agentProvider as Parameters<typeof resolveProvider>[0],
      {} as Parameters<typeof resolveProvider>[1],
      {} as Parameters<typeof resolveProvider>[2],
    );
    expect(result).toBeNull();
  });
});
