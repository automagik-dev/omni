/**
 * Reaction dual-emits must not dispatch the agent from the message path.
 *
 * channel-whatsapp and channel-discord republish inbound reactions as
 * message.received with content.type='reaction' (backward compatibility for
 * non-dispatch consumers). Before the guard in `shouldProcessMessage`, that
 * pseudo-message dispatched the agent as if the user had typed the emoji —
 * even on instances whose triggerEvents never included reaction.received.
 * Reaction dispatch belongs to the reaction.received subscription, which
 * honors triggerEvents + triggerReactions.
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

function harness(instanceOverrides: Record<string, unknown> = {}) {
  const accessService = {
    checkAccess: async () => ({ allowed: true, reason: 'ok' }),
    requestPairing: async () => {},
  } as never;

  const agentRunner = {
    getInstanceWithProvider: async () => ({
      id: 'inst-1',
      channel: 'whatsapp-baileys',
      agentId: 'agent-1',
      ownerIdentifier: 'owner-self',
      allowFirstParty: true,
      agentReplyFilter: null,
      inboundMaxAgeMinutes: null,
      accessMode: 'blocklist',
      ...instanceOverrides,
    }),
  } as never;

  const chatsService = {
    getById: async () => null,
    findOrCreate: async () => ({ chat: { id: 'chat-1' } }),
    findByExternalIdSmart: async () => null,
    getAllExternalIds: async () => [],
  } as never;
  const messagesService = { getByExternalId: async () => null } as never;
  const routeResolver = { resolve: async () => null } as never;

  return { accessService, agentRunner, chatsService, messagesService, routeResolver };
}

const METADATA = { instanceId: 'inst-1', channelType: 'whatsapp-baileys' };

function payloadOf(content: Record<string, unknown>) {
  return {
    externalId: 'ext-1',
    chatId: '5511999999999@s.whatsapp.net',
    from: '5511999999999',
    content,
    rawPayload: {},
  } as never;
}

describe('shouldProcessMessage vs reaction dual-emits', () => {
  test("content.type='reaction' is skipped even when the instance triggers on message.received", async () => {
    const h = harness({ triggerEvents: ['message.received'] });

    const instance = await __test__.shouldProcessMessage(
      h.agentRunner,
      h.accessService,
      h.chatsService,
      h.messagesService,
      h.routeResolver,
      fakeDb(),
      payloadOf({ type: 'reaction', text: '👍' }),
      METADATA,
      undefined,
    );

    expect(instance).toBeNull();
  });

  test("content.type='reaction' is skipped even when reaction.received is also configured (no double dispatch)", async () => {
    const h = harness({ triggerEvents: ['message.received', 'reaction.received'] });

    const instance = await __test__.shouldProcessMessage(
      h.agentRunner,
      h.accessService,
      h.chatsService,
      h.messagesService,
      h.routeResolver,
      fakeDb(),
      payloadOf({ type: 'reaction', text: '👍' }),
      METADATA,
      undefined,
    );

    expect(instance).toBeNull();
  });

  test('a plain text message still dispatches (guard is reaction-specific)', async () => {
    const h = harness({ triggerEvents: ['message.received'] });

    const instance = await __test__.shouldProcessMessage(
      h.agentRunner,
      h.accessService,
      h.chatsService,
      h.messagesService,
      h.routeResolver,
      fakeDb(),
      payloadOf({ type: 'text', text: 'oi' }),
      METADATA,
      undefined,
    );

    expect(instance).not.toBeNull();
  });

  test('a text message whose text happens to be an emoji still dispatches', async () => {
    const h = harness({ triggerEvents: ['message.received'] });

    const instance = await __test__.shouldProcessMessage(
      h.agentRunner,
      h.accessService,
      h.chatsService,
      h.messagesService,
      h.routeResolver,
      fakeDb(),
      payloadOf({ type: 'text', text: '👍' }),
      METADATA,
      undefined,
    );

    expect(instance).not.toBeNull();
  });
});
