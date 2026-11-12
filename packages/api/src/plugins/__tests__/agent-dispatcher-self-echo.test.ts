/**
 * The self-echo guard in `shouldProcessMessage` (#938).
 *
 * WhatsApp (baileys) echoes the instance's own outbound sends back as
 * `message.received` with `rawPayload.isFromMe=true`. The plugin-level echo
 * filter (`sentMessageIds`) is an in-memory TTL cache wiped on reconnect — a
 * miss lets the echo reach the dispatcher, where a `mode:'all'` reply filter
 * dispatches it and the agent answers itself in a loop.
 *
 * The guard is deliberately NOT a blanket isFromMe skip: the owner typing on
 * their own phone also arrives with isFromMe=true via multi-device sync and
 * MUST still dispatch (#344 — no other CI test pins that direction). The
 * distinguisher is durable: agent outbound sends are persisted with
 * `senderAgentId` (message-persistence, message.sent path), so an isFromMe
 * message whose externalId already exists as an agent-authored row is the
 * bot's own echo; one without it is the human owner.
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { __test__ } from '../agent-dispatcher';

/** Chainable drizzle stub: builders return self, awaiting yields `rows`. */
function chain<T>(rows: T): T {
  const self: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (onOk: (v: T) => unknown, onErr?: (e: unknown) => unknown) => Promise.resolve(rows).then(onOk, onErr);
        }
        return () => self;
      },
    },
  );
  return self as T;
}

function fakeDb(): Database {
  const db = {
    select: () => chain([{ ownerIdentifier: 'owner-x' }]),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> =>
      cb({ execute: async () => [] as unknown, select: () => chain([{ ownerIdentifier: 'owner-x' }]) }),
    execute: async () => [],
  };
  return db as unknown as Database;
}

function fakeInstance(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inst-1',
    channel: 'whatsapp-baileys',
    agentId: 'agent-1',
    ownerIdentifier: '5511960008976@s.whatsapp.net',
    allowFirstParty: true,
    // The loop-prone configuration from #938: reply filter mode 'all'.
    agentReplyFilter: { mode: 'all' },
    inboundMaxAgeMinutes: null,
    accessMode: 'blocklist',
    ...overrides,
  };
}

interface HarnessOptions {
  instanceOverrides?: Record<string, unknown>;
  /** The persisted row `getByExternalId` returns for the inbound externalId. */
  persistedMessage?: { senderAgentId: string | null } | null;
}

function harness({ instanceOverrides = {}, persistedMessage = null }: HarnessOptions = {}) {
  const messageLookups: Array<{ chatId: string; externalId: string }> = [];

  const accessService = {
    checkAccess: async () => ({ allowed: true, reason: 'ok' }),
    requestPairing: async () => {},
  } as never;

  const agentRunner = {
    getInstanceWithProvider: async () => fakeInstance(instanceOverrides),
  } as never;

  const chatsService = {
    getById: async () => null,
    findOrCreate: async () => ({ chat: { id: 'chat-1' } }),
    findByExternalIdSmart: async () => ({ id: 'chat-1' }),
    getAllExternalIds: async () => [],
  } as never;
  const messagesService = {
    getByExternalId: async (chatId: string, externalId: string) => {
      messageLookups.push({ chatId, externalId });
      return persistedMessage;
    },
  } as never;
  const routeResolver = { resolve: async () => null } as never;

  return { messageLookups, accessService, agentRunner, chatsService, messagesService, routeResolver };
}

const METADATA = { instanceId: 'inst-1', channelType: 'whatsapp-baileys' };

function payload(overrides: Record<string, unknown> = {}) {
  return {
    externalId: 'wa-msg-1',
    chatId: '5511999999999@s.whatsapp.net',
    from: '5511999999999@s.whatsapp.net',
    content: { type: 'text', text: 'hi' },
    rawPayload: {},
    ...overrides,
  } as never;
}

async function run(h: ReturnType<typeof harness>, p: never) {
  return __test__.shouldProcessMessage(
    h.agentRunner,
    h.accessService,
    h.chatsService,
    h.messagesService,
    h.routeResolver,
    fakeDb(),
    p,
    METADATA,
    undefined,
  );
}

describe('shouldProcessMessage self-echo guard (#938)', () => {
  test("bot's own echo (isFromMe + persisted senderAgentId) is skipped under mode 'all'", async () => {
    const h = harness({ persistedMessage: { senderAgentId: 'agent-1' } });

    const instance = await run(
      h,
      payload({
        from: '5511960008976:2@s.whatsapp.net',
        rawPayload: { isFromMe: true },
      }),
    );

    expect(instance).toBeNull();
    expect(h.messageLookups).toEqual([{ chatId: 'chat-1', externalId: 'wa-msg-1' }]);
  });

  test('#344 companion: owner phone message (isFromMe, NO senderAgentId) still dispatches', async () => {
    // Owner typed on their own phone — multi-device sync delivers it with
    // isFromMe=true, and message-persistence stores it WITHOUT senderAgentId.
    const h = harness({ persistedMessage: { senderAgentId: null } });

    const instance = await run(
      h,
      payload({
        from: '5511960008976@s.whatsapp.net',
        rawPayload: { isFromMe: true },
      }),
    );

    expect(instance).not.toBeNull();
  });

  test("group chat: bot's own echo is skipped", async () => {
    // The #938 incident shape: group route with mode 'all', echo sender is the
    // instance's own device-suffixed JID.
    const h = harness({ persistedMessage: { senderAgentId: 'agent-1' } });

    const instance = await run(
      h,
      payload({
        chatId: '120363000000000000@g.us',
        from: '5511960008976:2@s.whatsapp.net',
        rawPayload: { isFromMe: true },
      }),
    );

    expect(instance).toBeNull();
  });

  test('group chat: owner phone message still dispatches', async () => {
    const h = harness({ persistedMessage: { senderAgentId: null } });

    const instance = await run(
      h,
      payload({
        chatId: '120363000000000000@g.us',
        from: '5511960008976@s.whatsapp.net',
        rawPayload: { isFromMe: true },
      }),
    );

    expect(instance).not.toBeNull();
  });

  test('isFromMe with no persisted row fails open (dispatch proceeds)', async () => {
    // Race/miss tolerance: if the outbound row is not yet visible, behave like
    // #344 — never silently drop what might be a human message.
    const h = harness({ persistedMessage: null });

    const instance = await run(h, payload({ rawPayload: { isFromMe: true } }));

    expect(instance).not.toBeNull();
  });

  test('regular inbound message (no isFromMe) never hits the echo lookup', async () => {
    const h = harness({ persistedMessage: { senderAgentId: 'agent-1' } });

    const instance = await run(h, payload());

    expect(instance).not.toBeNull();
    expect(h.messageLookups).toEqual([]);
  });
});

/**
 * WhatsApp Business coexistence (#1661): an echo of a message the business sent
 * from the WhatsApp Business app, and a shared-history message, carry
 * `rawPayload.noAgentDispatch`. Owner decision 2026-11-11: an echo NEVER
 * dispatches an agent, unlike a Baileys phone-sent message (#344 above).
 * The instance has no stale-age guard (0), so the marker is the only reason.
 */
describe('shouldProcessMessage noAgentDispatch marker (coexistence)', () => {
  const coexistence = {
    channel: 'whatsapp-business',
    ownerIdentifier: '15550783881',
    inboundMaxAgeMinutes: 0,
  };
  const echoRaw = {
    isFromMe: true,
    key: { id: 'wamid.echo-1', fromMe: true },
    upsertType: 'notify',
    messageTimestamp: Math.floor(Date.now() / 1000),
    coexistence: 'smb_message_echoes',
  };
  const echo = (raw: Record<string, unknown>) =>
    payload({ externalId: 'wamid.echo-1', chatId: '16505551234', from: '15550783881', rawPayload: raw });

  test('a coexistence echo never dispatches, before any DB lookup', async () => {
    const h = harness({ instanceOverrides: coexistence, persistedMessage: null });

    const instance = await run(h, echo({ ...echoRaw, noAgentDispatch: true }));

    expect(instance).toBeNull();
    expect(h.messageLookups).toEqual([]);
  });

  test('a shared-history message never dispatches', async () => {
    const h = harness({ instanceOverrides: coexistence, persistedMessage: null });

    const instance = await run(
      h,
      payload({
        externalId: 'wamid.hist-1',
        chatId: '16505551234',
        from: '16505551234',
        rawPayload: {
          isFromMe: false,
          key: { id: 'wamid.hist-1', fromMe: false },
          isHistorySync: true,
          messageTimestamp: Math.floor(Date.now() / 1000),
          coexistence: 'history',
          noAgentDispatch: true,
        },
      }),
    );

    expect(instance).toBeNull();
  });

  test('control: the same echo without the marker dispatches (the #344 owner-phone rule)', async () => {
    const h = harness({ instanceOverrides: coexistence, persistedMessage: null });

    const instance = await run(h, echo(echoRaw));

    expect(instance).not.toBeNull();
  });
});
