/**
 * Tests for reaction sender
 */

import { describe, expect, it } from 'bun:test';
import { buildReactionContent } from '../senders/reaction';

describe('Reaction Sender', () => {
  describe('buildReactionContent', () => {
    it('builds reaction content with emoji', () => {
      const content = buildReactionContent('1234567890@s.whatsapp.net', 'msg_123', '👍', true);

      expect(content).toHaveProperty('react');
      const react = (content as { react: { text: string; key: { remoteJid: string; id: string; fromMe: boolean } } })
        .react;
      expect(react.text).toBe('👍');
      expect(react.key.remoteJid).toBe('1234567890@s.whatsapp.net');
      expect(react.key.id).toBe('msg_123');
      expect(react.key.fromMe).toBe(true);
    });

    it('builds reaction content for other user message', () => {
      const content = buildReactionContent('1234567890@s.whatsapp.net', 'msg_123', '❤️', false);

      const react = (content as { react: { key: { fromMe: boolean } } }).react;
      expect(react.key.fromMe).toBe(false);
    });

    it('builds removal reaction with empty string', () => {
      const content = buildReactionContent('1234567890@s.whatsapp.net', 'msg_123', '', true);

      const react = (content as { react: { text: string } }).react;
      expect(react.text).toBe('');
    });

    it('handles various emoji types', () => {
      const emojis = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

      for (const emoji of emojis) {
        const content = buildReactionContent('1234567890@s.whatsapp.net', 'msg_123', emoji, true);

        const react = (content as { react: { text: string } }).react;
        expect(react.text).toBe(emoji);
      }
    });
  });
});
