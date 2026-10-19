/**
 * Tests for reaction sender
 */

import { describe, expect, it, mock } from 'bun:test';
import { setupMessageHandlers } from '../handlers/messages';
import { WhatsAppPlugin } from '../plugin';
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

    it('includes participant for group messages from other users', () => {
      const content = buildReactionContent(
        '120363424772797713@g.us',
        '3AAFEE9E6DB2E7864DE2',
        '👍',
        false,
        '178035101794451@lid',
      );

      const react = (content as { react: { key: { fromMe: boolean; participant?: string } } }).react;
      expect(react.key.fromMe).toBe(false);
      expect(react.key.participant).toBe('178035101794451@lid');
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

describe('inbound reaction target (opt-in inboundReplyContext)', () => {
  const INSTANCE_ID = 'reaction-instance';
  const GROUP = '120363424772797713@g.us';
  const DM = '5511888888888@s.whatsapp.net';
  const OWN_LID = '100000000000001@lid';
  const OWN_PHONE_JID = '5511999990000@s.whatsapp.net';
  const OTHER = '5511777777777@s.whatsapp.net';

  type Listener = (arg: unknown) => Promise<void>;

  function setup({ inboundReplyContext = true }: { inboundReplyContext?: boolean } = {}) {
    const plugin = new WhatsAppPlugin();
    if (inboundReplyContext) (plugin as any).inboundReplyContextInstances.add(INSTANCE_ID);
    const listeners = new Map<string, Listener>();
    const sock = {
      ev: { on: (event: string, listener: Listener) => listeners.set(event, listener) },
      presenceSubscribe: mock(async () => {}),
      user: { id: '5511999990000:12@s.whatsapp.net', lid: '100000000000001:5@lid' },
    };
    const handleReactionReceived = mock(async (..._args: unknown[]) => {});
    (plugin as any).sockets = new Map([[INSTANCE_ID, sock]]);
    (plugin as any).handleReactionReceived = handleReactionReceived;
    setupMessageHandlers(sock as any, plugin, INSTANCE_ID);
    const emitReaction = (key: Record<string, unknown>, reactionKey: Record<string, unknown>, text = '👍') =>
      listeners.get('messages.reaction')?.([{ key, reaction: { key: reactionKey, text } }]);
    const targetOfCall = (index = 0) => handleReactionReceived.mock.calls[index]?.[7];
    return { emitReaction, handleReactionReceived, targetOfCall };
  }

  it('group: target.fromMe is true when the reacted-to participant is this line via LID', async () => {
    const { emitReaction, targetOfCall } = setup();
    await emitReaction(
      { id: 'MSG-1', remoteJid: GROUP, fromMe: true, participant: OWN_LID },
      { id: 'R-1', remoteJid: GROUP, fromMe: false, participant: OTHER },
    );
    expect(targetOfCall()).toEqual({ fromMe: true, participant: OWN_LID });
  });

  it('group: target.fromMe is true when the reacted-to participant is this line via phone JID', async () => {
    const { emitReaction, targetOfCall } = setup();
    await emitReaction(
      { id: 'MSG-1', remoteJid: GROUP, fromMe: false, participant: OWN_PHONE_JID },
      { id: 'R-1', remoteJid: GROUP, fromMe: false, participant: OTHER },
    );
    expect(targetOfCall()).toEqual({ fromMe: true, participant: OWN_PHONE_JID });
  });

  it('group: target.fromMe is false for another participant message, whatever key.fromMe says', async () => {
    const { emitReaction, targetOfCall } = setup();
    await emitReaction(
      { id: 'MSG-1', remoteJid: GROUP, fromMe: true, participant: OTHER },
      { id: 'R-1', remoteJid: GROUP, fromMe: false, participant: OTHER },
    );
    expect(targetOfCall()).toEqual({ fromMe: false, participant: OTHER });
  });

  it('DM: this line reacting to its own message has target.fromMe true', async () => {
    const { emitReaction, targetOfCall } = setup();
    await emitReaction({ id: 'MSG-1', remoteJid: DM, fromMe: true }, { id: 'R-1', remoteJid: DM, fromMe: true });
    expect(targetOfCall()).toEqual({ fromMe: true });
  });

  it('DM: this line reacting to the contact message has target.fromMe false', async () => {
    const { emitReaction, targetOfCall } = setup();
    await emitReaction({ id: 'MSG-1', remoteJid: DM, fromMe: false }, { id: 'R-1', remoteJid: DM, fromMe: true }, '');
    expect(targetOfCall()).toEqual({ fromMe: false });
  });

  // Baileys' cleanMessage has already rewritten a contact's reaction key to this
  // line's perspective (normaliseKey), so key.fromMe arrives relative to us.
  it('DM: the contact reacting to this line message has target.fromMe true', async () => {
    const { emitReaction, targetOfCall } = setup();
    await emitReaction({ id: 'MSG-1', remoteJid: DM, fromMe: true }, { id: 'R-1', remoteJid: DM, fromMe: false }, '✅');
    expect(targetOfCall()).toEqual({ fromMe: true });
  });

  it('DM: the contact reacting to its own message has target.fromMe false', async () => {
    const { emitReaction, targetOfCall } = setup();
    await emitReaction(
      { id: 'MSG-1', remoteJid: DM, fromMe: false },
      { id: 'R-1', remoteJid: DM, fromMe: false },
      '⏳',
    );
    expect(targetOfCall()).toEqual({ fromMe: false });
  });

  it('flag off: no target is built for a group or a DM reaction', async () => {
    const { emitReaction, handleReactionReceived, targetOfCall } = setup({ inboundReplyContext: false });
    await emitReaction(
      { id: 'MSG-1', remoteJid: GROUP, fromMe: true, participant: OWN_LID },
      { id: 'R-1', remoteJid: GROUP, fromMe: false, participant: OTHER },
    );
    await emitReaction({ id: 'MSG-2', remoteJid: DM, fromMe: true }, { id: 'R-2', remoteJid: DM, fromMe: false }, '');
    expect(handleReactionReceived).toHaveBeenCalledTimes(2);
    expect(targetOfCall(0)).toBeUndefined();
    expect(targetOfCall(1)).toBeUndefined();
  });

  it('keeps every existing handleReactionReceived argument unchanged', async () => {
    const { emitReaction, handleReactionReceived } = setup();
    await emitReaction(
      { id: 'MSG-1', remoteJid: GROUP, fromMe: false, participant: OTHER },
      { id: 'R-1', remoteJid: GROUP, fromMe: false, participant: OTHER },
      '✅',
    );
    expect(handleReactionReceived.mock.calls[0]?.slice(0, 7)).toEqual([
      INSTANCE_ID,
      'R-1',
      GROUP,
      '5511777777777',
      '✅',
      'MSG-1',
      false,
    ]);
  });
});
