/**
 * Regression for omni#1090: a WhatsApp reply carries the quoted stanza in
 * `contextInfo.quotedMessage`; it must surface as quoted text + quoted sender so
 * `messages.quoted_text` / `quoted_sender_name` stop landing null.
 */

import { describe, expect, it } from 'bun:test';
import type { WAMessage } from 'baileys';
import fixtures from '../../test/fixtures/real-payloads.json';
import { extractQuotedContext } from '../handlers/messages';

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
