/**
 * Message edit persistence (#1061).
 *
 * WhatsApp/Discord journal an edit as `content.type: 'edit'` under a fresh
 * externalId with `rawPayload.editedMessageId` naming the original; the edit
 * must land on the original row's edit history. Telegram re-uses the original
 * externalId and flags `rawPayload.isEdited`.
 */

import { describe, expect, mock, test } from 'bun:test';
import type { Services } from '../../services';
import { maybeRecordMessageEdit } from '../message-persistence';

function harness(found: boolean) {
  const recordEdit = mock(async () => ({}));
  const getByExternalId = mock(async () => (found ? { id: 'orig-uuid' } : null));
  const services = { messages: { getByExternalId, recordEdit } } as unknown as Services;
  return { services, recordEdit, getByExternalId };
}

const AT = new Date('2026-09-10T00:00:00Z');

describe('maybeRecordMessageEdit', () => {
  test("'edit' event applies the new text to the original message via editedMessageId", async () => {
    const h = harness(true);
    await maybeRecordMessageEdit(
      h.services,
      true,
      { editedMessageId: 'ORIG123', editedAt: 1_700_000_000_000 },
      'chat-1',
      'edit-row-uuid',
      'edit',
      'corrected text',
      AT,
      '5511888888888',
    );
    expect(h.getByExternalId).toHaveBeenCalledWith('chat-1', 'ORIG123');
    expect(h.recordEdit).toHaveBeenCalledWith(
      'orig-uuid',
      'corrected text',
      new Date(1_700_000_000_000),
      '5511888888888',
    );
  });

  test("'edit' event whose original is unknown is a no-op", async () => {
    const h = harness(false);
    await maybeRecordMessageEdit(h.services, true, { editedMessageId: 'NOPE' }, 'chat-1', 'x', 'edit', 't', AT, 'u');
    expect(h.recordEdit).not.toHaveBeenCalled();
  });

  test('Telegram isEdited on an existing row records the edit on that row', async () => {
    const h = harness(true);
    await maybeRecordMessageEdit(h.services, false, { isEdited: true }, 'chat-1', 'row-uuid', 'text', 'new', AT, 'u');
    expect(h.getByExternalId).not.toHaveBeenCalled();
    expect(h.recordEdit).toHaveBeenCalledWith('row-uuid', 'new', AT, 'u');
  });

  test('a freshly created ordinary message is not an edit', async () => {
    const h = harness(true);
    await maybeRecordMessageEdit(h.services, true, {}, 'chat-1', 'row-uuid', 'text', 'hi', AT, 'u');
    expect(h.recordEdit).not.toHaveBeenCalled();
  });
});
