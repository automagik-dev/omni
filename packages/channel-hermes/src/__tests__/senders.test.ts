/**
 * Hermes senders — unit tests.
 *
 * Verifies each sender produces the exact Hermes payload shape from the
 * Mutant Postman collection. The HTTP layer is bypassed by spying on
 * `HermesClient.sendMessage` / `HermesClient.upload`.
 */

import { describe, expect, it, spyOn } from 'bun:test';

import { HermesClient } from '../client';
import { sendContact } from '../senders/contact';
import { sendInteractiveButtons, sendInteractiveList } from '../senders/interactive';
import { sendLocation } from '../senders/location';
import { resolveHermesMediaType, sendMedia } from '../senders/media';
import { sendReaction } from '../senders/reaction';
import { sendTemplate } from '../senders/template';
import { sendText } from '../senders/text';
import type { HermesSendResponse } from '../types';
import { HermesApiError } from '../utils/errors';

function makeClient(): HermesClient {
  return new HermesClient({
    baseUrl: 'https://hermes.example.com',
    username: 'user',
    password: 'pass',
    mediaId: 'line-uuid-0001',
  });
}

const OK_RESPONSE: HermesSendResponse = { message: { id: '06d5424d-c5ef-430b-a14f-2811fda00cb2' } };

describe('sendText', () => {
  it('produces a type=text payload with text as a plain STRING', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendText(client, '5511999998888', 'some text');

    expect(spy).toHaveBeenCalledWith({
      to: '5511999998888',
      recipient_type: 'individual',
      type: 'text',
      text: 'some text',
    });
  });

  it('normalizes E.164 input and includes context.message_id on reply', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendText(client, '+55 11 99999-8888', 'reply', 'wamid.target');

    const arg = spy.mock.calls[0]?.[0];
    expect(arg?.to).toBe('5511999998888');
    expect(arg?.context).toEqual({ message_id: 'wamid.target' });
  });
});

describe('sendMedia', () => {
  it('maps mime types to Hermes media kinds', () => {
    expect(resolveHermesMediaType('image/jpeg')).toBe('image');
    expect(resolveHermesMediaType('image/webp')).toBe('sticker');
    expect(resolveHermesMediaType('audio/ogg')).toBe('audio');
    expect(resolveHermesMediaType('video/mp4')).toBe('video');
    expect(resolveHermesMediaType('application/pdf')).toBe('document');
    expect(resolveHermesMediaType(undefined)).toBe('document');
  });

  it('sends image by url with flat content_type + url + caption', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendMedia(client, '5511999998888', { url: 'https://cdn.example.com/a.jpg' }, 'image/jpeg', 'a caption');

    expect(spy).toHaveBeenCalledWith({
      to: '5511999998888',
      recipient_type: 'individual',
      type: 'image',
      content_type: 'image/jpeg',
      url: 'https://cdn.example.com/a.jpg',
      caption: 'a caption',
    });
  });

  it('drops captions for audio', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendMedia(client, '5511999998888', { url: 'https://cdn.example.com/v.mp3' }, 'audio/mpeg', 'ignored');

    const arg = spy.mock.calls[0]?.[0];
    expect(arg?.type).toBe('audio');
    expect(arg?.caption).toBeUndefined();
  });

  it('uploads bytes first and sends via id when no url is available', async () => {
    const client = makeClient();
    const uploadSpy = spyOn(client, 'upload').mockResolvedValueOnce({ id: 'file-uuid-9' });
    const sendSpy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    const bytes = new TextEncoder().encode('%PDF').buffer as ArrayBuffer;
    await sendMedia(client, '5511999998888', { bytes }, 'application/pdf', 'doc caption');

    expect(uploadSpy).toHaveBeenCalledWith(bytes, 'application/pdf');
    expect(sendSpy).toHaveBeenCalledWith({
      to: '5511999998888',
      recipient_type: 'individual',
      type: 'document',
      content_type: 'application/pdf',
      id: 'file-uuid-9',
      caption: 'doc caption',
    });
  });

  it('sends stickers via the sticker.link object form', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendMedia(client, '5511999998888', { url: 'https://cdn.example.com/s.webp' }, 'image/webp');

    expect(spy).toHaveBeenCalledWith({
      to: '5511999998888',
      recipient_type: 'individual',
      type: 'sticker',
      sticker: { link: 'https://cdn.example.com/s.webp' },
    });
  });

  it('throws for byte-only stickers (no sticker-via-id form in the spec)', async () => {
    const client = makeClient();
    const bytes = new ArrayBuffer(8);
    await expect(sendMedia(client, '5511999998888', { bytes }, 'image/webp')).rejects.toThrow(HermesApiError);
  });

  it('throws when neither url nor bytes are provided', async () => {
    await expect(sendMedia(makeClient(), '5511999998888', {}, 'image/jpeg')).rejects.toThrow(HermesApiError);
  });
});

describe('sendLocation', () => {
  it('produces a type=location payload with numeric coordinates', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendLocation(client, '5511999998888', -24.5985591, -45.577325, 'HQ', 'Av. Paulista, 1000');

    expect(spy).toHaveBeenCalledWith({
      to: '5511999998888',
      recipient_type: 'individual',
      type: 'location',
      location: { latitude: -24.5985591, longitude: -45.577325, name: 'HQ', address: 'Av. Paulista, 1000' },
    });
  });
});

describe('sendContact', () => {
  it('expands the simplified card into the contacts[] array shape', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendContact(client, '5511999998888', [
      { name: 'Maria Silva', phones: ['+55 11 98888-7777'], emails: ['maria@example.com'] },
    ]);

    expect(spy).toHaveBeenCalledWith({
      to: '5511999998888',
      recipient_type: 'individual',
      type: 'contacts',
      contacts: [
        {
          name: { formatted_name: 'Maria Silva', first_name: 'Maria Silva' },
          phones: [{ phone: '+55 11 98888-7777', type: 'CELL', wa_id: '5511988887777' }],
          emails: [{ email: 'maria@example.com', type: 'WORK' }],
        },
      ],
    });
  });
});

describe('sendReaction', () => {
  it('produces a type=reaction payload with message_id + emoji', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendReaction(client, '5511999998888', 'wamid.target', '😀');

    expect(spy).toHaveBeenCalledWith({
      to: '5511999998888',
      recipient_type: 'individual',
      type: 'reaction',
      reaction: { message_id: 'wamid.target', emoji: '😀' },
    });
  });

  it('throws INVALID_REQUEST without a target messageId', async () => {
    await expect(sendReaction(makeClient(), '5511999998888', '', '😀')).rejects.toThrow(HermesApiError);
  });
});

describe('sendTemplate', () => {
  it('produces a namespaced deterministic template payload with body parameters', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendTemplate(client, '5511999998888', {
      namespace: 'a1b2c3d4_name_space',
      name: 'welcome_message',
      language: 'pt_BR',
      bodyParameters: ['John', '12345'],
    });

    expect(spy).toHaveBeenCalledWith({
      to: '5511999998888',
      recipient_type: 'individual',
      type: 'template',
      template: {
        namespace: 'a1b2c3d4_name_space',
        language: { policy: 'deterministic', code: 'pt_BR' },
        name: 'welcome_message',
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'John' },
              { type: 'text', text: '12345' },
            ],
          },
        ],
      },
    });
  });

  it('omits components when there are no body parameters', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendTemplate(client, '5511999998888', { namespace: 'ns', name: 'plain', language: 'pt_BR' });

    const arg = spy.mock.calls[0]?.[0];
    expect(arg?.template?.components).toBeUndefined();
  });
});

describe('interactive senders', () => {
  it('produces the interactive button shape from the spec', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendInteractiveButtons(client, '5511999998888', 'Pick one', [
      { id: 'BTN_1', title: 'Yes' },
      { id: 'BTN_2', title: 'No' },
    ]);

    expect(spy).toHaveBeenCalledWith({
      to: '5511999998888',
      recipient_type: 'individual',
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: 'Pick one' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'BTN_1', title: 'Yes' } },
            { type: 'reply', reply: { id: 'BTN_2', title: 'No' } },
          ],
        },
      },
    });
  });

  it('produces the interactive list shape with header/footer/sections', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendInteractiveList(client, '5511999998888', {
      bodyText: 'BODY_TEXT',
      buttonText: 'BUTTON_TEXT',
      headerText: 'HEADER_TEXT',
      footerText: 'FOOTER_TEXT',
      sections: [
        {
          title: 'SECTION_1_TITLE',
          rows: [{ id: 'ROW_1', title: 'Row one', description: 'first row' }],
        },
      ],
    });

    expect(spy).toHaveBeenCalledWith({
      to: '5511999998888',
      recipient_type: 'individual',
      type: 'interactive',
      interactive: {
        type: 'list',
        header: { type: 'text', text: 'HEADER_TEXT' },
        body: { text: 'BODY_TEXT' },
        footer: { text: 'FOOTER_TEXT' },
        action: {
          button: 'BUTTON_TEXT',
          sections: [{ title: 'SECTION_1_TITLE', rows: [{ id: 'ROW_1', title: 'Row one', description: 'first row' }] }],
        },
      },
    });
  });
});
