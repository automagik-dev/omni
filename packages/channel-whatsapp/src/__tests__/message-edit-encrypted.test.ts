/**
 * Encrypted edits end to end (#1061).
 *
 * WhatsApp delivers an edit as a `secretEncryptedMessage` whose payload is encrypted
 * under the ORIGINAL message's `messageSecret`. This exercises the whole inbound path:
 * the original message lands (its secret is remembered), the encrypted edit lands, and
 * the decrypted new text reaches `handleMessageEdited`.
 *
 * The ciphertext is a REAL captured edit; the expected plaintext is its edited text.
 */

import { describe, expect, it, mock } from 'bun:test';
import { EventEmitter } from 'node:events';
import { setupMessageHandlers } from '../handlers/messages';
import { WhatsAppPlugin } from '../plugin';

const GROUP = '120363406854035156@g.us';
const SENDER_LID = '217046273028329@lid';
const ORIG_ID = '3B335662F99E0B247ABE';
const SECRET = Buffer.from('MGULupwDcKGlKJDlJlZ+DlAyld9U+VmxvuJI1XNrgf8=', 'base64');
const ENC_IV = Buffer.from('L50Zn/v7vdNibfeL', 'base64');
const ENC_PAYLOAD = Buffer.from(
  'qDEc9XltNsL19474MjwjA027q7mtHgRhrsYUvc29lMdrsi0NmgZ7HiItLsW8I1DJ2az/dc/al/y1Yfxkt5y88NzT9cs1OwrcgCAV/XVHANJZ/umo3M8OvKlX7FARPVjUZRvKZm+fBOs9KmB+MSfLj+lVplqjBKmh5GYBJ3zdSeN4Ht/ZgoBpaMme307JGNhCn0xGTJW2fziOkBQhlHz6GdaxIhw=',
  'base64',
);

function harness() {
  const ev = new EventEmitter();
  const sock = { ev, presenceSubscribe: mock(async () => {}) } as unknown as Parameters<typeof setupMessageHandlers>[0];
  const plugin = new WhatsAppPlugin();
  (plugin as unknown as { config: unknown }).config = { apiBaseUrl: 'http://localhost:8882' };
  const handleEdited = mock(async () => {});
  (plugin as unknown as { handleMessageEdited: typeof handleEdited }).handleMessageEdited = handleEdited;
  (plugin as unknown as { emitMessageReceived: typeof handleEdited }).emitMessageReceived = mock(async () => {});
  (plugin as unknown as { handleMessageDelivered: typeof handleEdited }).handleMessageDelivered = mock(async () => {});
  // the original message only needs to seed the secret; its delivery path is not under test
  (plugin as unknown as { handleMessageReceived: typeof handleEdited }).handleMessageReceived = mock(async () => {});
  setupMessageHandlers(sock, plugin, 'inst-1');
  return { ev, handleEdited };
}

const flush = () => new Promise((r) => setTimeout(r, 20));

/** The original message, carrying the secret its future edit will be encrypted with. */
function originalMessage(id = ORIG_ID) {
  return {
    messages: [
      {
        key: { id, remoteJid: GROUP, fromMe: true, participant: SENDER_LID },
        messageTimestamp: Math.floor(Date.now() / 1000),
        pushName: 'Tester',
        message: {
          conversation: 'oi aqui vou editar',
          messageContextInfo: { messageSecret: SECRET },
        },
      },
    ],
    type: 'notify' as const,
  };
}

/** The edit, as WhatsApp actually delivers it: msgSecret envelope, MESSAGE_EDIT. */
function encryptedEdit(wrapperId = 'EDITWRAP-ENC-1') {
  return {
    messages: [
      {
        key: { id: wrapperId, remoteJid: GROUP, fromMe: true, participant: SENDER_LID },
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: {
          messageContextInfo: {},
          secretEncryptedMessage: {
            encIv: ENC_IV,
            encPayload: ENC_PAYLOAD,
            secretEncType: 2, // MESSAGE_EDIT
            targetMessageKey: { id: ORIG_ID, remoteJid: GROUP, fromMe: true },
          },
        },
      },
    ],
    type: 'notify' as const,
  };
}

describe('encrypted WhatsApp edits (secretEncryptedMessage)', () => {
  it('decrypts the edit and emits the new text', async () => {
    const h = harness();
    h.ev.emit('messages.upsert', originalMessage());
    await flush();
    h.ev.emit('messages.upsert', encryptedEdit());
    await flush();
    expect(h.handleEdited).toHaveBeenCalledTimes(1);
    const call = (h.handleEdited.mock.calls[0] ?? []) as unknown as string[];
    expect(call[0]).toBe('inst-1');
    expect(call[1]).toBe(ORIG_ID);
    expect(call[2]).toBe(GROUP);
    const newText = call[3] ?? '';
    expect(newText).toContain('oi aqui vou editar');
    expect(newText.length).toBeGreaterThan('oi aqui vou editar'.length);
  });

  it('stays silent when the original message (and its secret) was never seen', async () => {
    const h = harness();
    // target the handler never saw a secret for — cannot be decrypted, must not throw
    const orphan = encryptedEdit('EDITWRAP-ENC-2');
    const envelope = orphan.messages[0]?.message?.secretEncryptedMessage;
    if (envelope) envelope.targetMessageKey.id = 'NEVER-SEEN-ORIGINAL';
    h.ev.emit('messages.upsert', orphan);
    await flush();
    expect(h.handleEdited).not.toHaveBeenCalled();
  });
});
