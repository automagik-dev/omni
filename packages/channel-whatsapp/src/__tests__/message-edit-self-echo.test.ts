/**
 * Self-edit echo (#1061, second reopen).
 *
 * An edit made on ANOTHER device of this same account syncs as a MESSAGE_EDIT
 * protocol message on `messages.upsert` and never produces a `messages.update`
 * event. Swallowing the upsert (waiting for an update that never comes) lost the
 * edit entirely: no journal row, `editCount` stayed 0, the pre-edit text stayed.
 *
 * So the upsert now emits whenever it already carries the new text, and a bounded
 * seen-set keeps a third-party edit — which does reach us on BOTH paths — from
 * being emitted twice.
 */

import { describe, expect, it, mock } from 'bun:test';
import { EventEmitter } from 'node:events';
import { setupMessageHandlers } from '../handlers/messages';
import { WhatsAppPlugin } from '../plugin';

const GROUP = '120363000000000000@g.us';
const ME = '5511999998888@s.whatsapp.net';

function harness() {
  const ev = new EventEmitter();
  const sock = { ev, presenceSubscribe: mock(async () => {}) } as unknown as Parameters<typeof setupMessageHandlers>[0];
  const plugin = new WhatsAppPlugin();
  const handleEdited = mock(async () => {});
  (plugin as unknown as { handleMessageEdited: typeof handleEdited }).handleMessageEdited = handleEdited;
  (plugin as unknown as { emitMessageReceived: typeof handleEdited }).emitMessageReceived = mock(async () => {});
  (plugin as unknown as { handleMessageDelivered: typeof handleEdited }).handleMessageDelivered = mock(async () => {});
  setupMessageHandlers(sock, plugin, 'inst-1');
  return { ev, handleEdited };
}

const flush = () => new Promise((r) => setImmediate(r));

/** MESSAGE_EDIT (protocol type 14) as it syncs from the account's other device. */
let wrapSeq = 0;
function selfEditUpsert(targetId: string, newText: string) {
  // each edit arrives in its own wrapper message — the wrapper id is never reused
  return {
    messages: [
      {
        key: { id: `EDITWRAP${++wrapSeq}`, remoteJid: GROUP, fromMe: true, participant: ME },
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: {
          protocolMessage: {
            type: 14,
            key: { id: targetId, remoteJid: GROUP, fromMe: true },
            editedMessage: { conversation: newText },
          },
        },
      },
    ],
    type: 'notify' as const,
  };
}

describe('WhatsApp self-edit echo on messages.upsert', () => {
  it('emits the edit that arrives only as an upsert protocol message', async () => {
    const h = harness();
    h.ev.emit('messages.upsert', selfEditUpsert('ORIG-SELF-1', 'texto corrigido'));
    await flush();
    expect(h.handleEdited).toHaveBeenCalledWith('inst-1', 'ORIG-SELF-1', GROUP, 'texto corrigido', true);
  });

  it('does not emit twice when the same edit also arrives on messages.update', async () => {
    const h = harness();
    h.ev.emit('messages.upsert', selfEditUpsert('ORIG-SELF-2', 'uma vez só'));
    await flush();
    h.ev.emit('messages.update', [
      {
        key: { id: 'ORIG-SELF-2', remoteJid: GROUP, fromMe: true },
        update: { message: { editedMessage: { message: { conversation: 'uma vez só' } } } },
      },
    ]);
    await flush();
    expect(h.handleEdited).toHaveBeenCalledTimes(1);
  });

  it('a genuine second edit of the same message still emits', async () => {
    const h = harness();
    h.ev.emit('messages.upsert', selfEditUpsert('ORIG-SELF-3', 'primeira correção'));
    await flush();
    h.ev.emit('messages.upsert', selfEditUpsert('ORIG-SELF-3', 'segunda correção'));
    await flush();
    expect(h.handleEdited).toHaveBeenCalledTimes(2);
    expect(h.handleEdited).toHaveBeenLastCalledWith('inst-1', 'ORIG-SELF-3', GROUP, 'segunda correção', true);
  });

  it('an upsert edit without new text still defers to messages.update', async () => {
    const h = harness();
    h.ev.emit('messages.upsert', {
      messages: [
        {
          key: { id: 'EDITWRAP-NOTEXT', remoteJid: GROUP, fromMe: true, participant: ME },
          messageTimestamp: Math.floor(Date.now() / 1000),
          message: { protocolMessage: { type: 14, key: { id: 'ORIG-SELF-4', remoteJid: GROUP } } },
        },
      ],
      type: 'notify' as const,
    });
    await flush();
    expect(h.handleEdited).not.toHaveBeenCalled();

    h.ev.emit('messages.update', [
      {
        key: { id: 'ORIG-SELF-4', remoteJid: GROUP, fromMe: true },
        update: { message: { editedMessage: { message: { conversation: 'via update' } } } },
      },
    ]);
    await flush();
    expect(h.handleEdited).toHaveBeenCalledWith('inst-1', 'ORIG-SELF-4', GROUP, 'via update', true);
  });
});
