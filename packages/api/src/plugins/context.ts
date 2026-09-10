/**
 * Plugin context factory
 *
 * Creates the PluginContext required by channel plugins during initialization.
 */

import { randomUUID } from 'node:crypto';
import type { IngressClaim, PluginContext, PluginDatabase } from '@omni/channel-sdk';
import { type EventBus, createLogger, resolvePublishTenantId } from '@omni/core';
import type { Database } from '@omni/db';
import { type ChannelType, channelTypes, omniEvents } from '@omni/db';
import { eq } from 'drizzle-orm';

import { createPluginLogger } from './logger';
import { getPluginStorage } from './storage';

const log = createLogger('api:plugin-context');

/**
 * Create a plugin database adapter
 */
function createPluginDatabase(db: Database): PluginDatabase {
  return {
    async execute<T>(_sql: string, _params?: unknown[]): Promise<T[]> {
      // Note: This is a simplified implementation
      // Drizzle doesn't have a direct execute method for raw SQL
      // Plugins should use getDrizzle() for queries
      log.warn('PluginDatabase execute() is not implemented. Use getDrizzle() for queries.');
      return [];
    },
    getDrizzle(): unknown {
      return db;
    },
  };
}

/**
 * Inbound-message idempotency claim (#1032, parity with `WebhookService.
 * receive` from #958). The claim IS the journal row: inserting it makes the
 * `omni_events.idempotency_key` unique index the dedup authority. The plugin
 * then publishes UNDER this row's id, and the `message.received` persistence
 * consumer fills the row in (upsert on id). Fail-open: a claim that errors
 * (e.g. the instance row is missing) mints an id and lets the publish proceed
 * undeduped rather than dropping a real message.
 */
function createIngressClaim(db: Database): IngressClaim {
  return {
    async claim({ idempotencyKey, instanceId, channelType, externalId }) {
      const id = randomUUID();
      try {
        const claimed = await db
          .insert(omniEvents)
          .values({
            id,
            externalId,
            channel: (channelTypes as readonly string[]).includes(channelType)
              ? (channelType as ChannelType)
              : 'discord',
            instanceId,
            eventType: 'message.received',
            direction: 'inbound',
            status: 'received',
            idempotencyKey,
            receivedAt: new Date(),
            metadata: { correlationId: id, source: `channel:${channelType}`, idempotencyKey },
            tenantId: resolvePublishTenantId(undefined, instanceId),
          })
          .onConflictDoNothing({ target: omniEvents.idempotencyKey })
          .returning({ id: omniEvents.id });
        return claimed.length > 0 ? id : null;
      } catch (error) {
        log.warn('Ingress idempotency claim failed; publishing without dedup', {
          idempotencyKey,
          error: String(error),
        });
        return id;
      }
    },
    async release(eventId) {
      await db.delete(omniEvents).where(eq(omniEvents.id, eventId));
    },
  };
}

export interface CreatePluginContextOptions {
  /** The plugin ID for scoped storage/logging */
  pluginId: string;
  /** Event bus for publishing/subscribing */
  eventBus: EventBus;
  /** Database connection */
  db: Database;
}

/**
 * Create a PluginContext for a channel plugin
 */
export function createPluginContext(options: CreatePluginContextOptions): PluginContext {
  const { pluginId, eventBus, db } = options;

  const env = (process.env.NODE_ENV ?? 'development') as 'development' | 'staging' | 'production';
  const apiPort = process.env.API_PORT ?? '8881';
  const apiHost = process.env.API_HOST ?? 'localhost';

  return {
    eventBus,
    storage: getPluginStorage(pluginId),
    logger: createPluginLogger(pluginId),
    config: {
      env,
      apiBaseUrl: `http://${apiHost}:${apiPort}`,
      webhookBaseUrl: process.env.WEBHOOK_BASE_URL ?? `http://${apiHost}:${apiPort}/webhooks`,
      mediaStorage: {
        type: 'local',
        basePath: process.env.MEDIA_STORAGE_PATH ?? './data/media',
      },
    },
    db: createPluginDatabase(db),
    ingressClaim: createIngressClaim(db),
  };
}
