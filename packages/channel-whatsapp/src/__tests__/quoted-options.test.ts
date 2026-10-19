/**
 * Quoting a message Omni itself sent: the stored row's rawPayload is the
 * sent-row shape {externalId, isFromMe, to} (no `key`, no `message`), which
 * Baileys cannot quote. buildQuotedOptions must pass a full WAMessage through
 * unchanged and build the fallback quote for anything else.
 */

import { describe, expect, it, mock } from 'bun:test';
import type { OutgoingMessage } from '@omni/channel-sdk';
import { WhatsAppPlugin } from '../plugin';

const INSTANCE_ID = 'test-instance';
const JID = '5511888888888@s.whatsapp.net';
const GROUP_JID = '120363424772797713@g.us';
const PARTICIPANT = '178035101794451@lid';

async function withHumanDelayDisabled(run: () => Promise<void>) {
  const previous = process.env.WHATSAPP_HUMAN_DELAY_ENABLED;
  const previousTyping = process.env.WHATSAPP_TYPING_SIMULATION_ENABLED;
  process.env.WHATSAPP_HUMAN_DELAY_ENABLED = 'false';
  process.env.WHATSAPP_TYPING_SIMULATION_ENABLED = 'false';
  try {
    await run();
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, 'WHATSAPP_HUMAN_DELAY_ENABLED');
    else process.env.WHATSAPP_HUMAN_DELAY_ENABLED = previous;
    if (previousTyping === undefined) Reflect.deleteProperty(process.env, 'WHATSAPP_TYPING_SIMULATION_ENABLED');
    else process.env.WHATSAPP_TYPING_SIMULATION_ENABLED = previousTyping;
  }
}

function newPlugin(): WhatsAppPlugin {
  const plugin = new WhatsAppPlugin();
  (plugin as any).logger = { info: mock(), debug: mock(), warn: mock(), error: mock() };
  return plugin;
}

function reply(to: string, metadata: Record<string, unknown>, replyTo = 'OWN-ID'): OutgoingMessage {
  return { to, content: { type: 'text', text: 'reply' }, replyTo, metadata };
}

function buildQuoted(plugin: WhatsAppPlugin, message: OutgoingMessage, jid: string) {
  return (plugin as any).buildQuotedOptions(message, jid) as { quoted: Record<string, unknown> } | undefined;
}

describe('buildQuotedOptions', () => {
  it('passes a full WAMessage rawPayload through as the same object', () => {
    const waMessage = {
      key: { id: 'IN-ID', remoteJid: JID, fromMe: false },
      message: { conversation: 'hello from contact' },
      messageTimestamp: 1700000000,
    };
    const result = buildQuoted(
      newPlugin(),
      reply(JID, { replyToFromMe: false, replyToText: 'hello from contact', replyToRawPayload: waMessage }, 'IN-ID'),
      JID,
    );
    expect(result?.quoted).toBe(waMessage);
    expect(waMessage).toEqual({
      key: { id: 'IN-ID', remoteJid: JID, fromMe: false },
      message: { conversation: 'hello from contact' },
      messageTimestamp: 1700000000,
    });
  });

  it("builds the fallback quote for Omni's own sent-row rawPayload", () => {
    const result = buildQuoted(
      newPlugin(),
      reply(JID, {
        replyToFromMe: true,
        replyToText: 'hi',
        replyToRawPayload: { externalId: 'OWN-ID', isFromMe: true, to: JID },
      }),
      JID,
    );
    expect(result).toEqual({
      quoted: { key: { id: 'OWN-ID', remoteJid: JID, fromMe: true }, message: { conversation: 'hi' } },
    });
    const key = result?.quoted.key as Record<string, unknown>;
    expect(Object.hasOwn(key, 'participant')).toBe(false);
  });

  it('uses an empty message when the sent row has no text', () => {
    const result = buildQuoted(
      newPlugin(),
      reply(JID, { replyToFromMe: true, replyToRawPayload: { externalId: 'OWN-ID', isFromMe: true, to: JID } }),
      JID,
    );
    expect(result).toEqual({ quoted: { key: { id: 'OWN-ID', remoteJid: JID, fromMe: true }, message: {} } });
  });

  it('carries key.participant from a stored group row without a usable message', () => {
    const result = buildQuoted(
      newPlugin(),
      reply(GROUP_JID, {
        replyToFromMe: true,
        replyToText: 'hi group',
        replyToRawPayload: { key: { id: 'OWN-ID', remoteJid: GROUP_JID, participant: PARTICIPANT } },
      }),
      GROUP_JID,
    );
    expect(result).toEqual({
      quoted: {
        key: { id: 'OWN-ID', remoteJid: GROUP_JID, fromMe: true, participant: PARTICIPANT },
        message: { conversation: 'hi group' },
      },
    });
  });

  it('keeps the no-rawPayload fallback unchanged', () => {
    const result = buildQuoted(newPlugin(), reply(JID, { replyToText: 'hi' }), JID);
    expect(result).toEqual({
      quoted: { key: { id: 'OWN-ID', remoteJid: JID, fromMe: false }, message: { conversation: 'hi' } },
    });
    expect(Object.hasOwn(result?.quoted.key as Record<string, unknown>, 'participant')).toBe(false);
  });
});

describe('sendMessage quoting an own sent message', () => {
  it('resolves with success when the quoted row is an Omni sent row', async () => {
    await withHumanDelayDisabled(async () => {
      const plugin = newPlugin();
      const sendMessage = mock(async (_jid: string, _content: unknown, opts?: { quoted?: unknown }) => {
        // Mirrors Baileys messages.js: it dereferences quoted.key.fromMe unconditionally.
        const quoted = opts?.quoted as { key: { fromMe?: boolean; participant?: string; remoteJid?: string } };
        const participant = quoted.key.fromMe ? 'me' : quoted.key.participant || quoted.key.remoteJid;
        return { key: { id: 'NEW-ID', participant }, message: { conversation: 'reply' } };
      });
      const mockSocket = {
        sendMessage,
        sendPresenceUpdate: mock(async () => {}),
        user: { id: '5511999999999@s.whatsapp.net' },
      };
      (plugin as any).sockets = new Map([[INSTANCE_ID, mockSocket]]);
      (plugin as any).eventBus = { publish: mock(async () => {}) };

      const result = await plugin.sendMessage(
        INSTANCE_ID,
        reply(JID, {
          replyToFromMe: true,
          replyToText: 'hi',
          replyToRawPayload: { externalId: 'OWN-ID', isFromMe: true, to: JID },
        }),
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('NEW-ID');
      expect(sendMessage).toHaveBeenCalledTimes(1);
      const opts = sendMessage.mock.calls[0]?.[2] as { quoted: { key: Record<string, unknown> } };
      expect(opts.quoted.key).toEqual({ id: 'OWN-ID', remoteJid: JID, fromMe: true });
    });
  });
});
