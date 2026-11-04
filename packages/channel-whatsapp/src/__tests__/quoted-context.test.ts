/**
 * Regression for omni#1090: a WhatsApp reply carries the quoted stanza in
 * `contextInfo.quotedMessage`; it must surface as quoted text + quoted sender so
 * `messages.quoted_text` / `quoted_sender_name` stop landing null.
 */

import { describe, expect, it } from 'bun:test';
import type { WAMessage } from 'baileys';
import fixtures from '../../test/fixtures/real-payloads.json';
import { extractInboundReplyTo, extractQuotedContext } from '../handlers/messages';
import { WhatsAppPlugin } from '../plugin';

const replyFixture = (fixtures.messages.extendedText as Array<{ payload: unknown }>).find(({ payload }) => {
  const msg = payload as WAMessage;
  return msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
})?.payload as WAMessage;

function wrap(message: Record<string, unknown>): WAMessage {
  return {
    key: { id: 'TEST', remoteJid: '5511999998888@s.whatsapp.net', fromMe: false },
    message,
  } as unknown as WAMessage;
}

describe('extractQuotedContext (omni#1090)', () => {
  it('lifts quoted text, participant and stanzaId from a real reply fixture', () => {
    expect(replyFixture).toBeDefined();
    expect(extractQuotedContext(replyFixture)).toEqual({
      stanzaId: 'AC23570AE54CCF58A8923E45CC6089E8',
      participant: '5511999990001@s.whatsapp.net',
      type: 'text',
      conversation: 'Buenas como q tão as coisas aí',
    });
  });

  it('uses the caption for quoted media, else a typed placeholder', () => {
    const base = { stanzaId: 'S1', participant: '5511999990001@s.whatsapp.net' };
    const captioned = wrap({
      imageMessage: {
        caption: 'look',
        contextInfo: { ...base, quotedMessage: { imageMessage: { mimetype: 'image/jpeg', caption: 'old pic' } } },
      },
    });
    expect(extractQuotedContext(captioned)?.conversation).toBe('old pic');

    const media = wrap({
      extendedTextMessage: {
        text: 'reply',
        contextInfo: { ...base, quotedMessage: { audioMessage: { mimetype: 'audio/ogg', ptt: true } } },
      },
    });
    expect(extractQuotedContext(media)).toMatchObject({ type: 'audio', conversation: '[audio]' });
  });

  it('returns undefined when there is no quote', () => {
    expect(extractQuotedContext(wrap({ conversation: 'hi' }))).toBeUndefined();
  });
});

describe('extractInboundReplyTo (typed, additive replyTo)', () => {
  const INSTANCE_ID = 'quote-instance';
  const CHAT = '5511999998888@s.whatsapp.net';
  const OWN_PHONE_JID = '5511999990000@s.whatsapp.net';
  const OWN_LID = '100000000000001@lid';
  const OTHER = '5511999990001@s.whatsapp.net';

  function pluginWithOwnAccount(): WhatsAppPlugin {
    const plugin = new WhatsAppPlugin();
    (plugin as any).sockets = new Map([
      [INSTANCE_ID, { user: { id: '5511999990000:12@s.whatsapp.net', lid: '100000000000001:5@lid' } }],
    ]);
    return plugin;
  }

  function quoteOf(quotedMessage: Record<string, unknown>, participant = OTHER) {
    return { stanzaId: 'QUOTED-ID', participant, quotedMessage };
  }

  const plugin = pluginWithOwnAccount();

  it('types a text reply', () => {
    const msg = wrap({ extendedTextMessage: { text: 'reply', contextInfo: quoteOf({ conversation: 'original' }) } });
    expect(extractInboundReplyTo(plugin, INSTANCE_ID, CHAT, msg)).toEqual({
      externalId: 'QUOTED-ID',
      chatId: CHAT,
      participant: OTHER,
      fromMe: false,
      type: 'text',
      text: 'original',
    });
  });

  it('types an image reply and reads the quoted caption', () => {
    const msg = wrap({
      imageMessage: {
        caption: 'look',
        contextInfo: quoteOf({ imageMessage: { mimetype: 'image/jpeg', caption: 'old pic' } }),
      },
    });
    expect(extractInboundReplyTo(plugin, INSTANCE_ID, CHAT, msg)).toMatchObject({
      externalId: 'QUOTED-ID',
      type: 'image',
      text: 'old pic',
    });
  });

  it('types a voice-note reply to a voice note (carrier audioMessage, isVoiceNote true)', () => {
    const msg = wrap({
      audioMessage: {
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true,
        contextInfo: quoteOf({ audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true } }),
      },
    });
    const replyTo = extractInboundReplyTo(plugin, INSTANCE_ID, CHAT, msg);
    expect(replyTo).toMatchObject({ externalId: 'QUOTED-ID', type: 'audio', isVoiceNote: true });
    expect(replyTo).not.toHaveProperty('text');
  });

  it('marks a quoted plain audio as isVoiceNote false', () => {
    const msg = wrap({
      extendedTextMessage: {
        text: 'r',
        contextInfo: quoteOf({ audioMessage: { mimetype: 'audio/mpeg', ptt: false } }),
      },
    });
    expect(extractInboundReplyTo(plugin, INSTANCE_ID, CHAT, msg)?.isVoiceNote).toBe(false);
  });

  it('types a sticker reply (carrier stickerMessage)', () => {
    const msg = wrap({ stickerMessage: { mimetype: 'image/webp', contextInfo: quoteOf({ conversation: 'hi' }) } });
    expect(extractInboundReplyTo(plugin, INSTANCE_ID, CHAT, msg)).toMatchObject({
      externalId: 'QUOTED-ID',
      type: 'text',
      text: 'hi',
    });
  });

  it('types a reply quoting a sticker', () => {
    const msg = wrap({
      extendedTextMessage: { text: 'r', contextInfo: quoteOf({ stickerMessage: { mimetype: 'image/webp' } }) },
    });
    expect(extractInboundReplyTo(plugin, INSTANCE_ID, CHAT, msg)).toMatchObject({ type: 'sticker' });
  });

  it('unwraps an ephemeral-wrapped reply', () => {
    const msg = wrap({
      ephemeralMessage: {
        message: { extendedTextMessage: { text: 'reply', contextInfo: quoteOf({ conversation: 'original' }) } },
      },
    });
    expect(extractInboundReplyTo(plugin, INSTANCE_ID, CHAT, msg)).toMatchObject({
      externalId: 'QUOTED-ID',
      type: 'text',
      text: 'original',
    });
  });

  it('unwraps a viewOnce-wrapped reply', () => {
    const msg = wrap({
      viewOnceMessageV2: {
        message: { imageMessage: { mimetype: 'image/jpeg', contextInfo: quoteOf({ conversation: 'original' }) } },
      },
    });
    expect(extractInboundReplyTo(plugin, INSTANCE_ID, CHAT, msg)).toMatchObject({
      externalId: 'QUOTED-ID',
      text: 'original',
    });
  });

  it('reads contextInfo from every other carrier', () => {
    for (const carrier of [
      'videoMessage',
      'documentMessage',
      'ptvMessage',
      'locationMessage',
      'contactMessage',
      'pollCreationMessage',
      'pollCreationMessageV3',
    ]) {
      const msg = wrap({ [carrier]: { contextInfo: quoteOf({ conversation: 'original' }) } });
      expect(extractInboundReplyTo(plugin, INSTANCE_ID, CHAT, msg)?.externalId).toBe('QUOTED-ID');
    }
  });

  it('is fromMe for a quote of the line own message via LID', () => {
    const msg = wrap({
      extendedTextMessage: { text: 'r', contextInfo: quoteOf({ conversation: 'mine' }, OWN_LID) },
    });
    expect(extractInboundReplyTo(plugin, INSTANCE_ID, CHAT, msg)).toMatchObject({ participant: OWN_LID, fromMe: true });
  });

  it('is fromMe for a quote of the line own message via phone JID', () => {
    const msg = wrap({
      extendedTextMessage: { text: 'r', contextInfo: quoteOf({ conversation: 'mine' }, OWN_PHONE_JID) },
    });
    expect(extractInboundReplyTo(plugin, INSTANCE_ID, CHAT, msg)).toMatchObject({
      participant: OWN_PHONE_JID,
      fromMe: true,
    });
  });

  it('is not fromMe when the quoted participant is unknown or absent', () => {
    const withoutParticipant = wrap({
      extendedTextMessage: { text: 'r', contextInfo: { stanzaId: 'QUOTED-ID', quotedMessage: { conversation: 'x' } } },
    });
    const replyTo = extractInboundReplyTo(plugin, INSTANCE_ID, CHAT, withoutParticipant);
    expect(replyTo?.fromMe).toBe(false);
    expect(replyTo).not.toHaveProperty('participant');
  });

  it('prefers contextInfo.remoteJid for chatId', () => {
    const msg = wrap({
      extendedTextMessage: {
        text: 'r',
        contextInfo: { ...quoteOf({ conversation: 'status' }), remoteJid: 'status@broadcast' },
      },
    });
    expect(extractInboundReplyTo(plugin, INSTANCE_ID, CHAT, msg)?.chatId).toBe('status@broadcast');
  });

  it('returns undefined when there is no quote', () => {
    expect(extractInboundReplyTo(plugin, INSTANCE_ID, CHAT, wrap({ conversation: 'hi' }))).toBeUndefined();
    const mentionOnly = wrap({ extendedTextMessage: { text: '@x', contextInfo: { mentionedJid: [OTHER] } } });
    expect(extractInboundReplyTo(plugin, INSTANCE_ID, CHAT, mentionOnly)).toBeUndefined();
  });
});
