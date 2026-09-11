/**
 * msgSecret decryption (#1061).
 *
 * Fixture is a REAL captured WhatsApp edit (group, self-edit): the ciphertext,
 * IV and the original message's `messageSecret` as they arrived on the wire.
 * Identifiers are the test author's own; the plaintext is the edited text.
 */

import { describe, expect, it } from 'bun:test';
import { MSG_SECRET_MESSAGE_EDIT, decryptMsgSecret, toNonAdJid } from '../msg-secret';

const FIXTURE = {
  encIv: Buffer.from('L50Zn/v7vdNibfeL', 'base64'),
  encPayload: Buffer.from(
    'qDEc9XltNsL19474MjwjA027q7mtHgRhrsYUvc29lMdrsi0NmgZ7HiItLsW8I1DJ2az/dc/al/y1Yfxkt5y88NzT9cs1OwrcgCAV/XVHANJZ/umo3M8OvKlX7FARPVjUZRvKZm+fBOs9KmB+MSfLj+lVplqjBKmh5GYBJ3zdSeN4Ht/ZgoBpaMme307JGNhCn0xGTJW2fziOkBQhlHz6GdaxIhw=',
    'base64',
  ),
  originalMessageSecret: Buffer.from('MGULupwDcKGlKJDlJlZ+DlAyld9U+VmxvuJI1XNrgf8=', 'base64'),
  originalMessageId: '3B335662F99E0B247ABE',
  senderLid: '217046273028329@lid',
  senderPn: '555197285829@s.whatsapp.net',
};

describe('decryptMsgSecret', () => {
  it('decrypts a real MESSAGE_EDIT envelope and yields the edited text', () => {
    const out = decryptMsgSecret({
      encIv: FIXTURE.encIv,
      encPayload: FIXTURE.encPayload,
      originalMessageSecret: FIXTURE.originalMessageSecret,
      originalMessageId: FIXTURE.originalMessageId,
      originalSenderJid: FIXTURE.senderLid,
      modificationSenderJid: FIXTURE.senderLid,
    });
    expect(out).not.toBeNull();
    expect(out?.toString('utf8')).toContain('oi aqui vou editar');
  });

  it('returns null when the sender form does not match (no throw)', () => {
    const out = decryptMsgSecret({
      encIv: FIXTURE.encIv,
      encPayload: FIXTURE.encPayload,
      originalMessageSecret: FIXTURE.originalMessageSecret,
      originalMessageId: FIXTURE.originalMessageId,
      originalSenderJid: FIXTURE.senderPn,
      modificationSenderJid: FIXTURE.senderPn,
    });
    expect(out).toBeNull();
  });

  it('returns null on a wrong secret instead of throwing', () => {
    const out = decryptMsgSecret({
      encIv: FIXTURE.encIv,
      encPayload: FIXTURE.encPayload,
      originalMessageSecret: Buffer.alloc(32),
      originalMessageId: FIXTURE.originalMessageId,
      originalSenderJid: FIXTURE.senderLid,
      modificationSenderJid: FIXTURE.senderLid,
    });
    expect(out).toBeNull();
  });

  it('uses "Message Edit" as the default use case', () => {
    const withDefault = decryptMsgSecret({
      encIv: FIXTURE.encIv,
      encPayload: FIXTURE.encPayload,
      originalMessageSecret: FIXTURE.originalMessageSecret,
      originalMessageId: FIXTURE.originalMessageId,
      originalSenderJid: FIXTURE.senderLid,
      modificationSenderJid: FIXTURE.senderLid,
    });
    const explicit = decryptMsgSecret({
      encIv: FIXTURE.encIv,
      encPayload: FIXTURE.encPayload,
      originalMessageSecret: FIXTURE.originalMessageSecret,
      originalMessageId: FIXTURE.originalMessageId,
      originalSenderJid: FIXTURE.senderLid,
      modificationSenderJid: FIXTURE.senderLid,
      useCase: MSG_SECRET_MESSAGE_EDIT,
    });
    expect(withDefault?.toString('hex')).toBe(explicit?.toString('hex') ?? '');
  });

  it('strips the device suffix from JIDs', () => {
    expect(toNonAdJid('555197285829:12@s.whatsapp.net')).toBe('555197285829@s.whatsapp.net');
    expect(toNonAdJid('217046273028329@lid')).toBe('217046273028329@lid');
  });
});
