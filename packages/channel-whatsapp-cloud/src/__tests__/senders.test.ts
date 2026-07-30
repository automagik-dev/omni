/**
 * Meta WhatsApp Cloud senders — unit tests.
 *
 * Verifies each sender produces the correct Graph API payload shape and
 * normalizes phone identifiers. The underlying HTTP layer is bypassed by
 * spying on `MetaWhatsAppClient.sendMessage`.
 */

import { describe, expect, it, spyOn } from 'bun:test';

import { MetaWhatsAppClient } from '../client';
import { sendContact } from '../senders/contact';
import { planInteractive, sendInteractive, sendLocationRequest } from '../senders/interactive';
import { sendLocation } from '../senders/location';
import { resolveMetaMediaType, sendMedia } from '../senders/media';
import { sendReaction } from '../senders/reaction';
import { sendTemplate } from '../senders/template';
import { sendText } from '../senders/text';
import type { MetaSendResponse } from '../types';
import { MetaApiError } from '../utils/errors';

function makeClient(): MetaWhatsAppClient {
  return new MetaWhatsAppClient({
    phoneNumberId: '123456789',
    accessToken: 'test-token',
    apiVersion: 'v25.0',
  });
}

const OK_RESPONSE: MetaSendResponse = {
  messaging_product: 'whatsapp',
  messages: [{ id: 'wamid.test123' }],
};

// ─────────────────────────────────────────────────────────────────────────
// sendText
// ─────────────────────────────────────────────────────────────────────────

describe('sendText', () => {
  it('produces a type=text payload with preview_url=false', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendText(client, '5511999998888', 'Hello there');

    expect(spy).toHaveBeenCalledWith({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5511999998888',
      type: 'text',
      text: { body: 'Hello there', preview_url: false },
    });
  });

  it('normalizes E.164 input with + to digits-only', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendText(client, '+55 11 99999-8888', 'hi');

    const arg = spy.mock.calls[0]?.[0];
    expect(arg?.to).toBe('5511999998888');
  });

  it('includes context.message_id when replyTo is passed', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendText(client, '5511999998888', 'reply', 'wamid.target');

    const arg = spy.mock.calls[0]?.[0];
    expect(arg?.context).toEqual({ message_id: 'wamid.target' });
  });

  it('omits context when replyTo is undefined', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendText(client, '5511999998888', 'no reply');

    const arg = spy.mock.calls[0]?.[0];
    expect(arg?.context).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// sendMedia
// ─────────────────────────────────────────────────────────────────────────

describe('resolveMetaMediaType', () => {
  it('maps image/* to image', () => expect(resolveMetaMediaType('image/png')).toBe('image'));
  it('maps image/webp to sticker', () => expect(resolveMetaMediaType('image/webp')).toBe('sticker'));
  it('maps audio/* to audio', () => expect(resolveMetaMediaType('audio/ogg')).toBe('audio'));
  it('maps video/* to video', () => expect(resolveMetaMediaType('video/mp4')).toBe('video'));
  it('maps application/* to document', () => expect(resolveMetaMediaType('application/pdf')).toBe('document'));
  it('defaults undefined to document', () => expect(resolveMetaMediaType()).toBe('document'));
});

describe('sendMedia', () => {
  it('produces a type=image payload with link', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendMedia(client, '5511999998888', 'https://cdn.example.com/img.jpg', 'image/jpeg', 'A caption');

    expect(spy).toHaveBeenCalledWith({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5511999998888',
      type: 'image',
      image: { link: 'https://cdn.example.com/img.jpg', caption: 'A caption' },
    });
  });

  it('uses link (not id) for the media handle', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendMedia(client, '5511999998888', 'https://cdn.example.com/x.pdf', 'application/pdf');

    const arg = spy.mock.calls[0]?.[0];
    expect(arg?.document?.link).toBe('https://cdn.example.com/x.pdf');
    expect(arg?.document?.id).toBeUndefined();
  });

  it('silently drops caption on audio sends (Meta rejects audio captions)', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendMedia(client, '5511999998888', 'https://cdn.example.com/voice.ogg', 'audio/ogg', 'should be dropped');

    const arg = spy.mock.calls[0]?.[0];
    expect(arg?.type).toBe('audio');
    expect(arg?.audio).toEqual({ link: 'https://cdn.example.com/voice.ogg' });
    expect(arg?.audio?.caption).toBeUndefined();
  });

  it('includes filename for document sends', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendMedia(
      client,
      '5511999998888',
      'https://cdn.example.com/report.pdf',
      'application/pdf',
      'Quarterly report',
      'report-q1.pdf',
    );

    const arg = spy.mock.calls[0]?.[0];
    expect(arg?.document).toEqual({
      link: 'https://cdn.example.com/report.pdf',
      caption: 'Quarterly report',
      filename: 'report-q1.pdf',
    });
  });

  it('drops filename for non-document sends', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendMedia(client, '5511999998888', 'https://cdn.example.com/x.jpg', 'image/jpeg', undefined, 'ignored.jpg');

    const arg = spy.mock.calls[0]?.[0];
    expect(arg?.image?.filename).toBeUndefined();
  });

  it('maps image/webp to sticker', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendMedia(client, '5511999998888', 'https://cdn.example.com/s.webp', 'image/webp');

    const arg = spy.mock.calls[0]?.[0];
    expect(arg?.type).toBe('sticker');
    expect(arg?.sticker?.link).toBe('https://cdn.example.com/s.webp');
  });

  it('includes context.message_id when replyTo is passed', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendMedia(
      client,
      '5511999998888',
      'https://cdn.example.com/x.jpg',
      'image/jpeg',
      undefined,
      undefined,
      'wamid.prev',
    );

    const arg = spy.mock.calls[0]?.[0];
    expect(arg?.context).toEqual({ message_id: 'wamid.prev' });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// sendLocation
// ─────────────────────────────────────────────────────────────────────────

describe('sendLocation', () => {
  it('produces a type=location payload with lat/lng', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendLocation(client, '+5511999998888', -23.5505, -46.6333, 'Av. Paulista', '1578 - São Paulo');

    expect(spy).toHaveBeenCalledWith({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5511999998888',
      type: 'location',
      location: {
        latitude: -23.5505,
        longitude: -46.6333,
        name: 'Av. Paulista',
        address: '1578 - São Paulo',
      },
    });
  });

  it('omits name/address when not provided', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendLocation(client, '5511999998888', 0, 0);

    const arg = spy.mock.calls[0]?.[0];
    expect(arg?.location).toEqual({ latitude: 0, longitude: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// sendContact
// ─────────────────────────────────────────────────────────────────────────

describe('sendContact', () => {
  it('builds Meta contacts[] shape with formatted_name and wa_id', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendContact(client, '5511999998888', [
      { name: 'Jane Doe', phones: ['+55 11 91234-5678'], emails: ['jane@example.com'] },
    ]);

    expect(spy).toHaveBeenCalledWith({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5511999998888',
      type: 'contacts',
      contacts: [
        {
          name: { formatted_name: 'Jane Doe', first_name: 'Jane Doe' },
          phones: [{ phone: '+55 11 91234-5678', type: 'CELL', wa_id: '5511912345678' }],
          emails: [{ email: 'jane@example.com', type: 'WORK' }],
        },
      ],
    });
  });

  it('supports multiple contacts in a single message', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendContact(client, '5511999998888', [
      { name: 'Alice', phones: ['5511000000001'] },
      { name: 'Bob', phones: ['5511000000002'] },
    ]);

    const arg = spy.mock.calls[0]?.[0];
    expect(arg?.contacts).toHaveLength(2);
  });

  it('omits phones/emails when not provided', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendContact(client, '5511999998888', [{ name: 'Nameless' }]);

    const arg = spy.mock.calls[0]?.[0];
    const contact = (arg?.contacts ?? [])[0] as { phones?: unknown; emails?: unknown };
    expect(contact.phones).toBeUndefined();
    expect(contact.emails).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// sendReaction
// ─────────────────────────────────────────────────────────────────────────

describe('sendReaction', () => {
  it('produces a type=reaction payload with message_id and emoji', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendReaction(client, '5511999998888', 'wamid.HBgM123', 'heart');

    expect(spy).toHaveBeenCalledWith({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5511999998888',
      type: 'reaction',
      reaction: { message_id: 'wamid.HBgM123', emoji: 'heart' },
    });
  });

  it('accepts empty emoji to clear a reaction', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendReaction(client, '5511999998888', 'wamid.HBgM123', '');

    const arg = spy.mock.calls[0]?.[0];
    expect(arg?.reaction?.emoji).toBe('');
    expect(arg?.reaction?.message_id).toBe('wamid.HBgM123');
  });

  it('throws when messageId is empty', async () => {
    const client = makeClient();
    expect(sendReaction(client, '5511999998888', '', 'fire')).rejects.toBeInstanceOf(MetaApiError);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// sendTemplate
// ─────────────────────────────────────────────────────────────────────────

describe('sendTemplate', () => {
  it('produces a type=template payload with name and language', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendTemplate(client, '+5511999998888', 'hello_world', 'pt_BR');

    expect(spy).toHaveBeenCalledWith({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5511999998888',
      type: 'template',
      template: {
        name: 'hello_world',
        language: { code: 'pt_BR', policy: 'deterministic' },
        components: undefined,
      },
    });
  });

  it('attaches body parameters as text components', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendTemplate(client, '5511999998888', 'order_update', 'en_US', ['Alice', '#42']);

    const arg = spy.mock.calls[0]?.[0];
    const components = arg?.template?.components ?? [];
    expect(components).toContainEqual({
      type: 'body',
      parameters: [
        { type: 'text', text: 'Alice' },
        { type: 'text', text: '#42' },
      ],
    });
  });

  it('attaches header media (image link) component', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendTemplate(client, '5511999998888', 'promo', 'en_US', ['Hello'], {
      type: 'image',
      link: 'https://cdn.example.com/banner.jpg',
    });

    const arg = spy.mock.calls[0]?.[0];
    const components = arg?.template?.components ?? [];
    expect(components[0]).toEqual({
      type: 'header',
      parameters: [{ type: 'image', image: { link: 'https://cdn.example.com/banner.jpg', id: undefined } }],
    });
  });

  it('attaches quick_reply button parameters', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendTemplate(client, '5511999998888', 'opt_in', 'en_US', undefined, undefined, [
      { sub_type: 'quick_reply', index: 0, payload: 'YES' },
    ]);

    const arg = spy.mock.calls[0]?.[0];
    const components = arg?.template?.components ?? [];
    expect(components).toContainEqual({
      type: 'button',
      sub_type: 'quick_reply',
      index: '0',
      parameters: [{ type: 'payload', payload: 'YES' }],
    });
  });

  it('includes context.message_id when replyTo is passed', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendTemplate(client, '5511999998888', 'hi', 'en_US', undefined, undefined, undefined, 'wamid.prev');

    const arg = spy.mock.calls[0]?.[0];
    expect(arg?.context).toEqual({ message_id: 'wamid.prev' });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// sendInteractive (session buttons / lists / cta_url)
// ─────────────────────────────────────────────────────────────────────────

describe('planInteractive', () => {
  it('maps up to 3 reply buttons onto interactive.button', () => {
    const plan = planInteractive(
      'Pick one',
      [{ text: 'Yes', data: 'opt_yes' }, { text: 'No', data: 'opt_no' }, { text: 'Maybe' }],
      'Options',
    );

    expect(plan.droppedRows).toBe(0);
    expect(plan.interactive).toEqual({
      type: 'button',
      body: { text: 'Pick one' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'opt_yes', title: 'Yes' } },
          { type: 'reply', reply: { id: 'opt_no', title: 'No' } },
          { type: 'reply', reply: { id: 'Maybe', title: 'Maybe' } },
        ],
      },
    });
  });

  it('maps 4-10 reply buttons onto a single-section interactive.list', () => {
    const buttons = Array.from({ length: 5 }, (_, i) => ({ text: `Option ${i + 1}`, data: `opt_${i + 1}` }));
    const plan = planInteractive('Menu', buttons, 'Choose');

    const interactive = plan.interactive as {
      type: string;
      action: { button: string; sections: Array<{ rows: unknown[] }> };
    };
    expect(interactive.type).toBe('list');
    expect(interactive.action.button).toBe('Choose');
    expect(interactive.action.sections[0]?.rows).toHaveLength(5);
    expect(plan.droppedRows).toBe(0);
  });

  it('caps lists at 10 rows and reports the overflow', () => {
    const buttons = Array.from({ length: 12 }, (_, i) => ({ text: `Option ${i + 1}` }));
    const plan = planInteractive('Menu', buttons, 'Choose');

    const interactive = plan.interactive as { action: { sections: Array<{ rows: unknown[] }> } };
    expect(interactive.action.sections[0]?.rows).toHaveLength(10);
    expect(plan.droppedRows).toBe(2);
  });

  it('maps a single URL button onto interactive.cta_url', () => {
    const plan = planInteractive('Check our docs', [{ text: 'Open docs', url: 'https://khal.ai/docs' }], 'Options');

    expect(plan.interactive).toEqual({
      type: 'cta_url',
      body: { text: 'Check our docs' },
      action: { name: 'cta_url', parameters: { display_text: 'Open docs', url: 'https://khal.ai/docs' } },
    });
  });

  it('folds inexpressible URL buttons into the body and keeps reply buttons', () => {
    const plan = planInteractive(
      'Pick',
      [
        { text: 'Yes', data: 'y' },
        { text: 'Site', url: 'https://khal.ai' },
      ],
      'Options',
    );

    expect(plan.body).toBe('Pick\n\nSite: https://khal.ai');
    const interactive = plan.interactive as { type: string; body: { text: string } };
    expect(interactive.type).toBe('button');
    expect(interactive.body.text).toBe('Pick\n\nSite: https://khal.ai');
  });

  it('truncates long titles to Meta limits (20 button / 24 row chars)', () => {
    const long = 'This button title is far beyond the limit';
    const asButton = planInteractive('t', [{ text: long }], 'Options');
    const btn = asButton.interactive as { action: { buttons: Array<{ reply: { title: string } }> } };
    expect(btn.action.buttons[0]?.reply.title).toHaveLength(20);

    const asList = planInteractive(
      't',
      Array.from({ length: 4 }, () => ({ text: long })),
      'Options',
    );
    const list = asList.interactive as { action: { sections: Array<{ rows: Array<{ title: string }> }> } };
    expect(list.action.sections[0]?.rows[0]?.title).toHaveLength(24);
  });
});

describe('sendInteractive', () => {
  it('sends type=interactive with normalized phone and reply context', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendInteractive(client, '+55 11 99999-8888', 'Pick', [{ text: 'Yes', data: 'y' }], 'wamid.ctx');

    const arg = spy.mock.calls[0]?.[0] as { to: string; type: string; context?: { message_id: string } };
    expect(arg.to).toBe('5511999998888');
    expect(arg.type).toBe('interactive');
    expect(arg.context).toEqual({ message_id: 'wamid.ctx' });
  });

  it('falls back to a plain text send when only folded URL buttons remain', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendInteractive(client, '5511999998888', 'Read this', [
      { text: 'Docs', url: 'https://khal.ai/docs' },
      { text: 'Blog', url: 'https://khal.ai/blog' },
    ]);

    const arg = spy.mock.calls[0]?.[0] as { type: string; text?: { body: string } };
    expect(arg.type).toBe('text');
    expect(arg.text?.body).toBe('Read this\n\nDocs: https://khal.ai/docs\nBlog: https://khal.ai/blog');
  });
});

describe('sendLocationRequest', () => {
  it('produces the location_request_message interactive payload', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendLocationRequest(client, '+55 11 99999-8888', 'Onde você está?');

    expect(spy).toHaveBeenCalledWith({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5511999998888',
      type: 'interactive',
      interactive: {
        type: 'location_request_message',
        body: { text: 'Onde você está?' },
        action: { name: 'send_location' },
      },
    });
  });
});
