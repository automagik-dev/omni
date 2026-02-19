import { describe, expect, test } from 'bun:test';
import type { Message } from 'discord.js';
import { downloadForwardedAttachment, extractForwardedAttachments } from '../handlers/forwarded-attachments';
import type { ForwardedAttachment } from '../handlers/forwarded-attachments';

describe('forwarded-attachments', () => {
  test('module exports expected functions', () => {
    expect(typeof extractForwardedAttachments).toBe('function');
    expect(typeof downloadForwardedAttachment).toBe('function');
  });

  test('extractForwardedAttachments returns empty for message without reference', async () => {
    const mockMessage = {
      reference: null,
      id: 'test-123',
    } as unknown as Message;
    const result = await extractForwardedAttachments(mockMessage);
    expect(result).toEqual([]);
  });

  test('extractForwardedAttachments returns empty for reference without messageId', async () => {
    const mockMessage = {
      reference: { messageId: null },
      id: 'test-123',
    } as unknown as Message;
    const result = await extractForwardedAttachments(mockMessage);
    expect(result).toEqual([]);
  });

  test('downloadForwardedAttachment handles network errors gracefully', async () => {
    const attachment: ForwardedAttachment = {
      url: 'https://invalid.nonexistent.example/file.png',
      filename: 'test.png',
      contentType: 'image/png',
      size: 1024,
    };
    const result = await downloadForwardedAttachment(attachment);
    expect(result).toBeNull();
  });
});
