/**
 * Tests for computeSessionId — per_thread strategy and backwards compatibility
 */

import { describe, expect, it } from 'bun:test';
import { computeSessionId } from '../agent-runner';

describe('computeSessionId', () => {
  describe('per_thread strategy', () => {
    it('returns thread:{chatId}:{threadId} when threadId is provided', () => {
      const result = computeSessionId('per_thread', 'u1', 'C123', 'T456');
      expect(result).toBe('thread:C123:T456');
    });

    it('falls back to thread:{chatId}:{chatId} when threadId is omitted', () => {
      const result = computeSessionId('per_thread', 'u1', 'C123');
      expect(result).toBe('thread:C123:C123');
    });

    it('falls back to thread:{chatId}:{chatId} when threadId is undefined', () => {
      const result = computeSessionId('per_thread', 'u1', 'C123', undefined);
      expect(result).toBe('thread:C123:C123');
    });

    it('different threadIds produce different sessionIds for same chat', () => {
      const t1 = computeSessionId('per_thread', 'u1', 'C123', 'T001');
      const t2 = computeSessionId('per_thread', 'u1', 'C123', 'T002');
      expect(t1).not.toBe(t2);
    });

    it('same threadId in different chats produces different sessionIds', () => {
      const s1 = computeSessionId('per_thread', 'u1', 'C001', 'T001');
      const s2 = computeSessionId('per_thread', 'u1', 'C002', 'T001');
      expect(s1).not.toBe(s2);
    });
  });

  describe('per_user strategy', () => {
    it('returns userId regardless of chat', () => {
      expect(computeSessionId('per_user', 'user-1', 'chat-A')).toBe('user-1');
      expect(computeSessionId('per_user', 'user-1', 'chat-B')).toBe('user-1');
    });

    it('threadId is ignored for per_user', () => {
      expect(computeSessionId('per_user', 'user-1', 'chat-A', 'T001')).toBe('user-1');
    });
  });

  describe('per_chat strategy', () => {
    it('returns chatId regardless of user', () => {
      expect(computeSessionId('per_chat', 'user-1', 'chat-A')).toBe('chat-A');
      expect(computeSessionId('per_chat', 'user-2', 'chat-A')).toBe('chat-A');
    });

    it('threadId is ignored for per_chat', () => {
      expect(computeSessionId('per_chat', 'user-1', 'chat-A', 'T001')).toBe('chat-A');
    });
  });

  describe('backwards compatibility', () => {
    it('per_user and per_chat work without threadId argument (existing callers)', () => {
      // These callers don't pass threadId — must still work
      expect(computeSessionId('per_user', 'user-1', 'chat-A')).toBe('user-1');
      expect(computeSessionId('per_chat', 'user-1', 'chat-A')).toBe('chat-A');
    });
  });
});
