/**
 * Gupshup senders — unit tests
 *
 * Verifies each sender correctly formats the request to GupshupClient.
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { GupshupClient } from '../client';
import { sendHandoff } from '../senders/handoff';
import { sendLocation } from '../senders/location';
import { resolveMediaType, sendMedia } from '../senders/media';
import { sendText } from '../senders/text';

function makeClient(): GupshupClient {
  return new GupshupClient('https://callbacks.example.com/abc', 'Bearer token', 'nx_omni_agent_reply');
}

describe('sendText', () => {
  it('calls client.send with TEXT type', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'send').mockResolvedValueOnce({ status: 'ok' });

    await sendText(client, '5511111111111', 'Hello');

    expect(spy).toHaveBeenCalledWith('5511111111111', { type: 'TEXT', text: 'Hello' });
  });
});

describe('sendMedia', () => {
  it('resolves image MIME type to IMAGE', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'send').mockResolvedValueOnce({ status: 'ok' });

    await sendMedia(client, '5511111111111', 'https://cdn.example.com/img.jpg', 'image/jpeg', 'Caption');

    expect(spy).toHaveBeenCalledWith('5511111111111', expect.objectContaining({ type: 'IMAGE' }));
  });

  it('resolves audio MIME type to AUDIO', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'send').mockResolvedValueOnce({ status: 'ok' });

    await sendMedia(client, '5511111111111', 'https://cdn.example.com/audio.ogg', 'audio/ogg');

    expect(spy).toHaveBeenCalledWith('5511111111111', expect.objectContaining({ type: 'AUDIO' }));
  });

  it('resolves video MIME type to VIDEO', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'send').mockResolvedValueOnce({ status: 'ok' });

    await sendMedia(client, '5511111111111', 'https://cdn.example.com/video.mp4', 'video/mp4');

    expect(spy).toHaveBeenCalledWith('5511111111111', expect.objectContaining({ type: 'VIDEO' }));
  });

  it('defaults unknown MIME type to DOCUMENT', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'send').mockResolvedValueOnce({ status: 'ok' });

    await sendMedia(client, '5511111111111', 'https://cdn.example.com/file.xyz');

    expect(spy).toHaveBeenCalledWith('5511111111111', expect.objectContaining({ type: 'DOCUMENT' }));
  });

  it('resolves image/webp to STICKER', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'send').mockResolvedValueOnce({ status: 'ok' });

    await sendMedia(client, '5511111111111', 'https://cdn.example.com/sticker.webp', 'image/webp');

    expect(spy).toHaveBeenCalledWith('5511111111111', expect.objectContaining({ type: 'STICKER' }));
  });
});

describe('resolveMediaType', () => {
  it('maps image/* to IMAGE', () => expect(resolveMediaType('image/png')).toBe('IMAGE'));
  it('maps image/webp to STICKER', () => expect(resolveMediaType('image/webp')).toBe('STICKER'));
  it('maps audio/* to AUDIO', () => expect(resolveMediaType('audio/mp3')).toBe('AUDIO'));
  it('maps video/* to VIDEO', () => expect(resolveMediaType('video/mp4')).toBe('VIDEO'));
  it('maps application/* to DOCUMENT', () => expect(resolveMediaType('application/pdf')).toBe('DOCUMENT'));
  it('defaults undefined to DOCUMENT', () => expect(resolveMediaType()).toBe('DOCUMENT'));
});

describe('sendLocation', () => {
  it('calls client.send with LOCATION type', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'send').mockResolvedValueOnce({ status: 'ok' });

    await sendLocation(client, '5511111111111', -23.5505, -46.6333, 'São Paulo', 'Av. Paulista');

    expect(spy).toHaveBeenCalledWith(
      '5511111111111',
      expect.objectContaining({
        type: 'LOCATION',
        latitude: -23.5505,
        longitude: -46.6333,
        name: 'São Paulo',
        address: 'Av. Paulista',
      }),
    );
  });
});

describe('sendHandoff', () => {
  it('calls client.send with HANDOFF type and text', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'send').mockResolvedValueOnce({ status: 'ok' });

    await sendHandoff(client, '5511111111111', 'Transferring to agent');

    expect(spy).toHaveBeenCalledWith('5511111111111', {
      type: 'HANDOFF',
      text: 'Transferring to agent',
      dados_lead: undefined,
      motivo_handoff: undefined,
    });
  });

  it('includes dados_lead and motivo_handoff when provided', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'send').mockResolvedValueOnce({ status: 'ok' });

    await sendHandoff(client, '5511111111111', 'Transferring to agent', 'queue=sales', 'Pediu humano');

    expect(spy).toHaveBeenCalledWith('5511111111111', {
      type: 'HANDOFF',
      text: 'Transferring to agent',
      dados_lead: 'queue=sales',
      motivo_handoff: 'Pediu humano',
    });
  });
});
