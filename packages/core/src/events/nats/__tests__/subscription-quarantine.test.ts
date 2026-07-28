/**
 * Consumer envelope validation at the subscription boundary
 * (wish: omni-full-multitenancy, Group G5; ADR-0008).
 *
 * `envelope.test.ts` proves the classification in isolation. This proves the
 * consume loop ACTS on it: a quarantined envelope is termed and routed to the
 * quarantine hook WITHOUT ever reaching the handler, while a legacy or
 * tenant-context envelope reaches the handler exactly as before (the dual-world
 * byte-identical contract for the legacy case).
 *
 * No broker: a fake `JsMsg`/consumer drives one message through, matching the
 * repo's mock-the-`nats`-client test convention.
 */

import { describe, expect, test } from 'bun:test';
import type { ConsumerMessages } from 'nats';
import { CURRENT_ENVELOPE_VERSION } from '../../envelope';
import type { OmniEvent } from '../../types';
import { createSubscription } from '../subscription';

const TENANT = '11111111-1111-4111-8111-11111111111a';

interface Recorded {
  acked: boolean;
  termed: boolean;
  nakDelay: number | null;
}

function fakeMsg(event: OmniEvent, rec: Recorded, redeliveryCount = 0) {
  return {
    data: new TextEncoder().encode(JSON.stringify(event)),
    headers: undefined,
    info: { streamSequence: 1, redeliveryCount },
    ack: () => {
      rec.acked = true;
    },
    term: () => {
      rec.termed = true;
    },
    nak: (delay: number) => {
      rec.nakDelay = delay;
    },
  };
}

/** A consumer that yields exactly one message then completes. */
function oneShotConsumer(msg: unknown): AsyncIterable<unknown> & { close: () => Promise<void> } {
  return {
    async *[Symbol.asyncIterator]() {
      yield msg;
    },
    close: async () => undefined,
  };
}

function eventWith(metadata: Partial<OmniEvent['metadata']>): OmniEvent {
  return {
    id: crypto.randomUUID(),
    type: 'message.received',
    payload: { instanceId: 'inst-1', chatId: 'chat-1' },
    timestamp: Date.now(),
    metadata: { correlationId: 'corr-1', ...metadata },
  } as OmniEvent;
}

/** Drive one message through a real subscription and collect the outcome. */
async function drive(
  event: OmniEvent,
  redeliveryCount = 0,
): Promise<{
  rec: Recorded;
  handlerCalls: number;
  quarantined: { reason: string; tenantId: string | undefined } | null;
}> {
  const rec: Recorded = { acked: false, termed: false, nakDelay: null };
  let handlerCalls = 0;
  let quarantined: { reason: string; tenantId: string | undefined } | null = null;

  createSubscription({
    pattern: 'message.received.>',
    consumer: oneShotConsumer(fakeMsg(event, rec, redeliveryCount)) as unknown as ConsumerMessages,
    handler: async () => {
      handlerCalls++;
    },
    onQuarantine: async (evt, classification) => {
      quarantined = { reason: classification.reason, tenantId: evt.metadata.tenantId };
    },
  });

  // Let the fire-and-forget processing loop settle.
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { rec, handlerCalls, quarantined };
}

describe('subscription quarantines bad envelopes before the handler', () => {
  test('legacy envelope reaches the handler and is acked (byte-identical dual world)', async () => {
    const { rec, handlerCalls, quarantined } = await drive(eventWith({}));
    expect(handlerCalls).toBe(1);
    expect(rec.acked).toBe(true);
    expect(rec.termed).toBe(false);
    expect(quarantined).toBeNull();
  });

  test('tenant-context envelope reaches the handler and is acked', async () => {
    const { rec, handlerCalls, quarantined } = await drive(
      eventWith({ envelopeVersion: CURRENT_ENVELOPE_VERSION, tenantId: TENANT }),
    );
    expect(handlerCalls).toBe(1);
    expect(rec.acked).toBe(true);
    expect(quarantined).toBeNull();
  });

  test('unknown-version envelope is quarantined and termed, never handled', async () => {
    const { rec, handlerCalls, quarantined } = await drive(eventWith({ envelopeVersion: 999, tenantId: TENANT }));
    expect(handlerCalls).toBe(0);
    expect(rec.acked).toBe(false);
    expect(rec.termed).toBe(true);
    expect(rec.nakDelay).toBeNull(); // no poison-loop retry
    expect(quarantined?.reason).toBe('unknown_version');
  });

  test('versioned envelope with no tenant is quarantined, never handled', async () => {
    const { rec, handlerCalls, quarantined } = await drive(eventWith({ envelopeVersion: CURRENT_ENVELOPE_VERSION }));
    expect(handlerCalls).toBe(0);
    expect(rec.termed).toBe(true);
    expect(quarantined?.reason).toBe('missing_tenant');
  });
});
