/** Events-only hook fixture; deliberately has no API credentials or actions. */
import { createHmac, randomUUID } from 'node:crypto';
import type { ConnectorManifest } from '@omni/connector-sdk';
import type { ConnectorEventPublisher, EventBus, GenericEventHandler, OmniEvent } from '@omni/core';
import { isConnectorEventType } from '@omni/core';
import { z } from 'zod';

export const HOOK_SECRET = 'synthetic-connector-hook-secret';
export const TYPED_EVENT = 'connector.gitlab.merge_request.merged';
export const DeliverySchema = z
  .object({
    event: z.string().default('merge_request.merged'),
    eventType: z.string().optional(),
    id: z.string().optional(),
  })
  .passthrough();

export const eventsOnlyConnector: ConnectorManifest = {
  id: 'gitlab',
  label: 'Events-only fixture',
  version: '1.0.0',
  credentialFields: [{ key: 'token', label: 'Optional token', optional: true, secret: true }],
  configSchema: z.object({}),
  validate: async () => ({ ok: true }),
  events: [{ key: 'merge_request.merged', label: 'Merged' }],
  actions: [],
  verification: { kind: 'hmac-sha256', header: 'x-signature', encoding: 'hex' },
  parseDelivery(rawBody) {
    const data = DeliverySchema.parse(JSON.parse(rawBody));
    return { eventKey: data.event, eventType: data.eventType, providerEventId: data.id, data };
  },
  guide: { setup: 'Use the synthetic hook secret; no API calls.' },
};

export function signHook(rawBody: string, secret = HOOK_SECRET): Record<string, string> {
  return { 'x-signature': createHmac('sha256', secret).update(rawBody).digest('hex') };
}

/** Await handlers so engine acceptance assertions need no timing guesses. */
export function connectorHookBus() {
  const handlers: Array<{ pattern: string; handler: GenericEventHandler }> = [];
  const events: OmniEvent[] = [];
  let failPublish = false;
  const publishInternal: EventBus['publishGeneric'] = async (type, payload, metadata) => {
    if (failPublish) throw new Error('Synthetic publish failure');
    const id = z.string().parse(metadata?.publishEventId ?? randomUUID());
    const event = { id, type, payload, metadata: { correlationId: id, ...metadata }, timestamp: Date.now() };
    events.push(event);
    for (const { pattern, handler } of handlers) {
      if (
        pattern === type ||
        (pattern.endsWith('.>') && (type === pattern.slice(0, -2) || type.startsWith(pattern.slice(0, -1))))
      )
        await handler(event);
    }
    return { id, sequence: events.length, stream: 'CUSTOM' };
  };
  const subscribe: EventBus['subscribePattern'] = async (pattern, handler) => {
    const entry = { pattern, handler };
    handlers.push(entry);
    return {
      id: randomUUID(),
      pattern,
      unsubscribe: async () => {
        handlers.splice(handlers.indexOf(entry), 1);
      },
    };
  };
  const bus: EventBus & ConnectorEventPublisher = {
    connect: async () => {},
    close: async () => {},
    isConnected: () => true,
    publish: async () => {
      throw new Error('Use connector publisher');
    },
    publishGeneric: async (type, payload, metadata) => {
      if (isConnectorEventType(type)) throw new Error('Use connector publisher');
      return publishInternal(type, payload, metadata);
    },
    publishConnector: publishInternal,
    subscribe: async () => {
      throw new Error('Use pattern subscription');
    },
    subscribePattern: subscribe,
    subscribeAll: async (handler, options) => subscribe('>', handler, options),
    subscribeMany: async () => {
      throw new Error('Use pattern subscription');
    },
  };
  return {
    bus,
    events,
    failNextPublish: (value: boolean) => {
      failPublish = value;
    },
  };
}
