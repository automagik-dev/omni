/**
 * POST /chats/sync-names repairs DMs named after the account itself.
 *
 * History sync stored the owner's own pushName as the name of the contact's DM
 * (live: 36 of 100 recent chats on one instance were named after its profile).
 * The route only rewrote empty or JID-shaped names, so it could not repair them.
 * It now also rewrites a DM whose STORED name is the instance's profile name:
 * with the contact's name when one is known, otherwise to null so the UI falls
 * back to the number. It never writes the owner's name, and leaves the self-chat
 * alone.
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { errorHandler } from '../../../middleware/error';
import type { AppVariables } from '../../../types';
import { chatsRoutes } from '../chats';

const INSTANCE_ID = '11c1a3e2-0000-4000-8000-000000000001';
const OWNER_NAME = 'Owner Name';
const OWNER_JID = '5511900000008@s.whatsapp.net';

interface ChatRow {
  id: string;
  externalId: string;
  canonicalId: string | null;
  name: string | null;
}

function mountHarness(chats: ChatRow[], contacts: Array<{ platformUserId: string; name?: string; isGroup: boolean }>) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('services', {
      instances: {
        getById: mock(async () => ({
          id: INSTANCE_ID,
          channel: 'whatsapp-baileys',
          name: 'pessoal-whatsapp',
          profileName: OWNER_NAME,
          ownerIdentifier: '5511900000008:45@s.whatsapp.net',
        })),
      },
      chats: {
        listStoredDmNames: mock(async () => chats),
        update: mock(async (id: string, data: Record<string, unknown>) => {
          updates.push({ id, data });
          return { id, ...data };
        }),
      },
    } as never);
    c.set('channelRegistry', {
      get: () => ({ capabilities: {}, fetchContacts: async () => ({ contacts }) }),
    } as never);
    c.set('apiKey', { id: 'k', name: 'k', scopes: ['*'], instanceIds: null, expiresAt: null } as never);
    await next();
  });
  app.route('/chats', chatsRoutes);
  const run = () =>
    app.request('/chats/sync-names', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: INSTANCE_ID }),
    });
  return { run, updates };
}

describe('POST /chats/sync-names — owner-named DMs', () => {
  test('renames a phone DM named after the owner to the contact name', async () => {
    const { run, updates } = mountHarness(
      [{ id: 'c1', externalId: '5511900006521@s.whatsapp.net', canonicalId: null, name: OWNER_NAME }],
      [{ platformUserId: '5511900006521@s.whatsapp.net', name: 'Bob', isGroup: false }],
    );

    const res = await run();

    expect(res.status).toBe(200);
    expect(updates).toEqual([{ id: 'c1', data: { name: 'Bob' } }]);
  });

  test('renames a @lid DM named after the owner through its canonical phone JID', async () => {
    const { run, updates } = mountHarness(
      [{ id: 'c2', externalId: '100000007669@lid', canonicalId: '5511900008006@s.whatsapp.net', name: OWNER_NAME }],
      [{ platformUserId: '5511900008006@s.whatsapp.net', name: 'Carol', isGroup: false }],
    );

    await run();

    expect(updates).toEqual([{ id: 'c2', data: { name: 'Carol' } }]);
  });

  test('clears an owner-named DM with no contact name, and reports it', async () => {
    const { run, updates } = mountHarness(
      [{ id: 'c3', externalId: '5511900001111@s.whatsapp.net', canonicalId: null, name: OWNER_NAME }],
      [],
    );

    const res = await run();
    const body = (await res.json()) as { data: { chatsUpdated: number; chatsCleared: number } };

    expect(updates).toEqual([{ id: 'c3', data: { name: null } }]);
    expect(body.data.chatsUpdated).toBe(0);
    expect(body.data.chatsCleared).toBe(1);
  });

  test('never writes the owner name from the contacts cache', async () => {
    const { run, updates } = mountHarness(
      [{ id: 'c4', externalId: '5511900002222@s.whatsapp.net', canonicalId: null, name: null }],
      [{ platformUserId: '5511900002222@s.whatsapp.net', name: OWNER_NAME, isGroup: false }],
    );

    await run();

    expect(updates).toEqual([]);
  });

  test('keeps a stored contact name when the contacts cache is empty', async () => {
    const { run, updates } = mountHarness(
      [{ id: 'c6', externalId: '5511900004444@s.whatsapp.net', canonicalId: null, name: 'Marina' }],
      [],
    );

    const res = await run();
    const body = (await res.json()) as { data: { chatsUpdated: number; chatsCleared: number } };

    expect(updates).toEqual([]);
    expect(body.data).toMatchObject({ chatsUpdated: 0, chatsCleared: 0 });
  });

  test('the instance label is not an owner name: a contact named like it is used', async () => {
    const { run, updates } = mountHarness(
      [{ id: 'c7', externalId: '5511900005555@s.whatsapp.net', canonicalId: null, name: null }],
      [{ platformUserId: '5511900005555@s.whatsapp.net', name: 'pessoal-whatsapp', isGroup: false }],
    );

    await run();

    expect(updates).toEqual([{ id: 'c7', data: { name: 'pessoal-whatsapp' } }]);
  });

  test('leaves the self-chat and real contact names alone', async () => {
    const { run, updates } = mountHarness(
      [
        { id: 'self', externalId: OWNER_JID, canonicalId: OWNER_JID, name: OWNER_NAME },
        { id: 'c5', externalId: '5511900003333@s.whatsapp.net', canonicalId: null, name: 'Dave' },
      ],
      [{ platformUserId: '5511900003333@s.whatsapp.net', name: 'Dave Contact', isGroup: false }],
    );

    await run();

    expect(updates).toEqual([]);
  });
});
