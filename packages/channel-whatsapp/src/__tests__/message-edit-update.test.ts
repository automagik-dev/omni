/**
 * Message edits (#1061, reopened).
 *
 * Baileys re-emits every MESSAGE_EDIT as `messages.update` with the ORIGINAL key
 * and `{ editedMessage: { message: <new content> } }`. That is the single source
 * for edit events; the raw protocol message on `messages.upsert` is swallowed so
 * it is neither journaled as `unknown` nor emitted twice.
 */

import { describe, expect, it, mock } from 'bun:test';
import { EventEmitter } from 'node:events';
import { setupMessageHandlers } from '../handlers/messages';
import { WhatsAppPlugin } from '../plugin';

const GROUP = '120363000000000000@g.us';

function harness() {
  const ev = new EventEmitter();
  const sock = { ev, presenceSubscribe: mock(async () => {}) } as unknown as Parameters<typeof setupMessageHandlers>[0];
  const plugin = new WhatsAppPlugin();
  const handleEdited = mock(async () => {});
  const emitReceived = mock(async () => {});
  (plugin as unknown as { handleMessageEdited: typeof handleEdited }).handleMessageEdited = handleEdited;
  (plugin as unknown as { emitMessageReceived: typeof emitReceived }).emitMessageReceived = emitReceived;
  (plugin as unknown as { handleMessageDelivered: typeof handleEdited }).handleMessageDelivered = mock(async () => {});
  setupMessageHandlers(sock, plugin, 'inst-1');
  return { ev, handleEdited, emitReceived };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('WhatsApp message edits via messages.update', () => {
  it('text edit of own group message lands on the original id with the new text', async () => {
    const h = harness();
    h.ev.emit('messages.update', [
      {
        key: { id: 'ORIG789', remoteJid: GROUP, fromMe: true, participant: '5511999998888@s.whatsapp.net' },
        update: { message: { editedMessage: { message: { extendedTextMessage: { text: 'edited in group' } } } } },
      },
    ]);
    await flush();
    expect(h.handleEdited).toHaveBeenCalledWith('inst-1', 'ORIG789', GROUP, 'edited in group', true);
  });

  it('media caption edit carries the caption', async () => {
    const h = harness();
    h.ev.emit('messages.update', [
      {
        key: { id: 'ORIG456', remoteJid: '5511999998888@s.whatsapp.net', fromMe: false },
        update: { message: { editedMessage: { message: { imageMessage: { caption: 'new caption' } } } } },
      },
    ]);
    await flush();
    expect(h.handleEdited).toHaveBeenCalledWith(
      'inst-1',
      'ORIG456',
      '5511999998888@s.whatsapp.net',
      'new caption',
      false,
    );
  });

  it('status-only updates do not emit edits', async () => {
    const h = harness();
    h.ev.emit('messages.update', [{ key: { id: 'X', remoteJid: GROUP, fromMe: true }, update: { status: 3 } }]);
    await flush();
    expect(h.handleEdited).not.toHaveBeenCalled();
  });

  it('the raw edit protocol message on messages.upsert is swallowed (not unknown, not a second edit)', async () => {
    const h = harness();
    h.ev.emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { id: 'EDITMSG1', remoteJid: GROUP, fromMe: true, participant: '5511999998888@s.whatsapp.net' },
          messageTimestamp: 1_700_000_000,
          message: {
            deviceSentMessage: {
              destinationJid: GROUP,
              message: {
                editedMessage: {
                  message: {
                    protocolMessage: {
                      key: { id: 'ORIG789', remoteJid: GROUP, fromMe: true },
                      type: 14,
                      editedMessage: { conversation: 'edited in group' },
                    },
                  },
                },
              },
            },
          },
        },
      ],
    });
    await flush();
    expect(h.handleEdited).not.toHaveBeenCalled();
    expect(h.emitReceived).not.toHaveBeenCalled();
  });
});
