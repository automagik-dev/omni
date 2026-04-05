/**
 * Gupshup senders — unit tests
 *
 * Verifies each sender correctly formats the request to GupshupClient.
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { GupshupClient } from '../client';
import { sendInteractive } from '../senders/interactive';
import { resolveMediaType, sendMedia } from '../senders/media';
import { sendTemplate } from '../senders/template';
import { sendText } from '../senders/text';
import type { GupshupInteractiveContent } from '../types';

function makeClient(): GupshupClient {
  return new GupshupClient('key', 'App', '5511000000000');
}

describe('sendText', () => {
  it('delegates to client.sendText', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendText').mockResolvedValueOnce({ status: 'submitted', messageId: 'msg_1' });

    await sendText(client, '5511111111111', 'Hello');

    expect(spy).toHaveBeenCalledWith('5511111111111', 'Hello');
  });
});

describe('sendMedia', () => {
  it('resolves image MIME type to "image"', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMedia').mockResolvedValueOnce({ status: 'submitted', messageId: 'msg_2' });

    await sendMedia(client, '5511111111111', 'https://cdn.example.com/img.jpg', 'image/jpeg', 'Caption');

    expect(spy).toHaveBeenCalledWith('5511111111111', 'image', 'https://cdn.example.com/img.jpg', 'Caption');
  });

  it('resolves audio MIME type to "audio"', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMedia').mockResolvedValueOnce({ status: 'submitted', messageId: 'msg_3' });

    await sendMedia(client, '5511111111111', 'https://cdn.example.com/audio.ogg', 'audio/ogg');

    expect(spy).toHaveBeenCalledWith('5511111111111', 'audio', 'https://cdn.example.com/audio.ogg', undefined);
  });

  it('defaults unknown MIME type to "file"', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMedia').mockResolvedValueOnce({ status: 'submitted', messageId: 'msg_4' });

    await sendMedia(client, '5511111111111', 'https://cdn.example.com/file.xyz');

    expect(spy).toHaveBeenCalledWith('5511111111111', 'file', 'https://cdn.example.com/file.xyz', undefined);
  });
});

describe('resolveMediaType', () => {
  it('maps image/* to image', () => expect(resolveMediaType('image/png')).toBe('image'));
  it('maps audio/* to audio', () => expect(resolveMediaType('audio/mp3')).toBe('audio'));
  it('maps video/* to video', () => expect(resolveMediaType('video/mp4')).toBe('video'));
  it('maps application/* to file', () => expect(resolveMediaType('application/pdf')).toBe('file'));
  it('defaults undefined to file', () => expect(resolveMediaType()).toBe('file'));
});

describe('sendTemplate', () => {
  it('delegates to client.sendTemplate', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendTemplate').mockResolvedValueOnce({ status: 'submitted', messageId: 'msg_5' });

    await sendTemplate(client, '5511111111111', 'order_confirmation', { name: 'Bob', orderId: '999' });

    expect(spy).toHaveBeenCalledWith('5511111111111', 'order_confirmation', { name: 'Bob', orderId: '999' });
  });
});

describe('sendInteractive', () => {
  it('delegates to client.sendInteractive', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendInteractive').mockResolvedValueOnce({
      status: 'submitted',
      messageId: 'msg_6',
    });

    const interactive: GupshupInteractiveContent = {
      type: 'button_reply',
      button_reply: { id: 'btn_1', title: 'Yes' },
    };
    await sendInteractive(client, '5511111111111', interactive);

    expect(spy).toHaveBeenCalledWith('5511111111111', interactive);
  });
});
