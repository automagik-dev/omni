/**
 * Tests for shouldAcceptDm — covers all three policy modes.
 */

import { describe, expect, it } from 'bun:test';

import { shouldAcceptDm } from '../dm-policy';

describe('shouldAcceptDm', () => {
  describe('open policy', () => {
    it('accepts every user', () => {
      const result = shouldAcceptDm('aad-user-1', { policy: 'open' });
      expect(result.accepted).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });

  describe('pairing policy', () => {
    it('accepts users on the allowlist', () => {
      const result = shouldAcceptDm('aad-user-1', {
        policy: 'pairing',
        allowlist: ['aad-user-1', 'aad-user-2'],
      });
      expect(result.accepted).toBe(true);
    });

    it('rejects users absent from the allowlist with the default message', () => {
      const result = shouldAcceptDm('aad-user-99', {
        policy: 'pairing',
        allowlist: ['aad-user-1'],
      });
      expect(result.accepted).toBe(false);
      expect(result.reason).toContain('direct messages');
    });

    it('uses the operator-supplied rejection message when provided', () => {
      const result = shouldAcceptDm('intruder', {
        policy: 'pairing',
        allowlist: ['paired-user'],
        rejectionMessage: 'Custom denial copy',
      });
      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('Custom denial copy');
    });

    it('rejects when no allowlist is configured', () => {
      const result = shouldAcceptDm('aad-user-1', { policy: 'pairing' });
      expect(result.accepted).toBe(false);
    });
  });

  describe('closed policy', () => {
    it('rejects every user with the default message', () => {
      const result = shouldAcceptDm('aad-user-1', { policy: 'closed' });
      expect(result.accepted).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('uses the operator-supplied rejection message when provided', () => {
      const result = shouldAcceptDm('aad-user-1', {
        policy: 'closed',
        rejectionMessage: 'Bot is muted',
      });
      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('Bot is muted');
    });
  });

  describe('unknown policy fallback', () => {
    it('fails open if the policy is unrecognised', () => {
      // Cast through unknown to simulate an operator typo / future enum value.
      const result = shouldAcceptDm('aad-user-1', {
        policy: 'rolling-thunder' as unknown as 'open',
      });
      expect(result.accepted).toBe(true);
    });
  });
});
