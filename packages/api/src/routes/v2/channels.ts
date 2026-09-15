/**
 * Channel capability matrix (issue #1187).
 *
 * Declarative counterpart to `GET /events/types`: what each loaded channel
 * plugin CAN publish, read from `capabilities.events` in the registry. The
 * declarations are held to the code by channel-sdk's event-capabilities test.
 */

import { Hono } from 'hono';
import type { ChannelCapabilitiesMatrix } from '../../schemas/openapi/channels';
import type { AppVariables } from '../../types';

const channelsRoutes = new Hono<{ Variables: AppVariables }>();

/**
 * GET /channels/capabilities - Event vocabulary and guarantees per loaded channel
 */
channelsRoutes.get('/capabilities', (c) => {
  const plugins = c.get('channelRegistry')?.getAll() ?? [];
  const items: ChannelCapabilitiesMatrix['items'] = plugins.map((plugin) => ({
    id: plugin.id,
    name: plugin.name,
    emits: plugin.capabilities.events ? [...plugin.capabilities.events.emits] : null,
    edits: plugin.capabilities.events?.edits ?? 'unknown',
    deletes: plugin.capabilities.events?.deletes ?? 'unknown',
    idempotency: plugin.capabilities.events?.idempotency ?? 'unknown',
  }));
  return c.json({ items });
});

export { channelsRoutes };
