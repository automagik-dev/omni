/**
 * Tests for typing indicators
 */

import { describe, expect, it } from 'bun:test';
import { DEFAULT_TYPING_DURATION } from '../typing';

describe('Typing Indicators', () => {
  describe('DEFAULT_TYPING_DURATION', () => {
    it('is 3 seconds', () => {
      expect(DEFAULT_TYPING_DURATION).toBe(3000);
    });
  });

  // Note: Full typing tests would require mocking the WASocket
  // These tests verify the constants and exported interface

  describe('exports', () => {
    it('exports sendTyping', async () => {
      const { sendTyping } = await import('../typing');
      expect(typeof sendTyping).toBe('function');
    });

    it('exports sendRecording', async () => {
      const { sendRecording } = await import('../typing');
      expect(typeof sendRecording).toBe('function');
    });

    it('exports stopTyping', async () => {
      const { stopTyping } = await import('../typing');
      expect(typeof stopTyping).toBe('function');
    });

    it('exports clearAllTypingTimers', async () => {
      const { clearAllTypingTimers } = await import('../typing');
      expect(typeof clearAllTypingTimers).toBe('function');
    });

    it('exports TypingIndicator class', async () => {
      const { TypingIndicator } = await import('../typing');
      expect(typeof TypingIndicator).toBe('function');
    });

    it('exports createTypingIndicator factory', async () => {
      const { createTypingIndicator } = await import('../typing');
      expect(typeof createTypingIndicator).toBe('function');
    });
  });
});
