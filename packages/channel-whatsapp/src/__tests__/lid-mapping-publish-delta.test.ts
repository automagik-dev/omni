import { describe, expect, mock, test } from 'bun:test';
import { WhatsAppPlugin } from '../plugin';

const OWNER_LID = '111@lid';
const OWNER_PHONE = '5511999@s.whatsapp.net';

function createPlugin() {
  const publishGeneric = mock(async (_event: string, _payload: unknown, _meta: unknown) => undefined);
  const plugin = new WhatsAppPlugin();
  (plugin as unknown as { eventBus: unknown }).eventBus = { publishGeneric };
  (plugin as unknown as { logger: unknown }).logger = { info: mock(), debug: mock(), warn: mock(), error: mock() };
  return { plugin, publishGeneric };
}

function eventsOf(publishGeneric: ReturnType<typeof createPlugin>['publishGeneric'], type: string) {
  return publishGeneric.mock.calls.filter(([t]) => t === type).map(([, payload]) => payload);
}

describe('issue #1040: contacts.upsert publishes only unknown mappings/names', () => {
  test('identical repeated upserts publish once', () => {
    const { plugin, publishGeneric } = createPlugin();
    const contact = { id: OWNER_PHONE, lid: OWNER_LID, name: 'Owner' };

    for (let i = 0; i < 5; i++) plugin.handleContactsUpsert('inst', [contact]);

    expect(eventsOf(publishGeneric, 'custom.lid-mapping.batch')).toEqual([
      { mappings: [{ lidJid: OWNER_LID, phoneJid: OWNER_PHONE }] },
    ]);
    expect(eventsOf(publishGeneric, 'custom.contacts.names')).toEqual([
      { names: [{ jid: OWNER_PHONE, name: 'Owner' }] },
    ]);
  });

  test('new or changed entries publish only the delta', () => {
    const { plugin, publishGeneric } = createPlugin();
    plugin.handleContactsUpsert('inst', [{ id: OWNER_PHONE, lid: OWNER_LID, name: 'Owner' }]);
    plugin.handleContactsUpsert('inst', [
      { id: '222@lid', phoneNumber: '5511888', name: 'Friend' },
      { id: OWNER_PHONE, lid: OWNER_LID, name: 'Owner Renamed' },
    ]);

    const batches = eventsOf(publishGeneric, 'custom.lid-mapping.batch');
    expect(batches).toHaveLength(2);
    expect(batches[1]).toEqual({ mappings: [{ lidJid: '222@lid', phoneJid: '5511888@s.whatsapp.net' }] });

    const names = eventsOf(publishGeneric, 'custom.contacts.names');
    expect(names).toHaveLength(2);
    expect(names[1]).toEqual({
      names: [
        { jid: OWNER_PHONE, name: 'Owner Renamed' },
        { jid: '222@lid', name: 'Friend' },
      ],
    });
  });
});
