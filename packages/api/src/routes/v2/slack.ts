/**
 * Slack-specific routes (#889)
 *
 * POST /slack/dm/open  - resolve (or open) the DM channel with a user
 * GET  /slack/search   - full-text message search (user token only)
 *
 * These are deliberately NOT on /messages: neither has a cross-channel
 * equivalent. Opening a DM by user id and searching messages are Slack
 * concepts, and pretending otherwise would put methods on the generic
 * ChannelPlugin contract that no other channel could implement.
 */

import { zValidator } from '@hono/zod-validator';
import type { ChannelType } from '@omni/core';
import { ERROR_CODES, OmniError } from '@omni/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { ApiKeyService } from '../../services/api-keys';
import type { ApiKeyData, AppVariables } from '../../types';

export const slackRoutes = new Hono<{ Variables: AppVariables }>();

const openDmSchema = z.object({
  instanceId: z.string().uuid(),
  userId: z.string().min(1).describe('Slack user id (U…) to open a DM with'),
});

const searchSchema = z.object({
  instanceId: z.string().uuid(),
  query: z.string().min(1),
  count: z.coerce.number().int().min(1).max(100).default(20),
  page: z.coerce.number().int().min(1).default(1),
});

interface SlackCapablePlugin {
  openDirectMessage?: (instanceId: string, userId: string) => Promise<string>;
  searchMessages?: (
    instanceId: string,
    query: string,
    options?: { count?: number; page?: number },
  ) => Promise<unknown[]>;
}

/**
 * Check if an API key has access to a specific instance.
 * Throws FORBIDDEN error if access is denied.
 */
function checkInstanceAccess(apiKey: ApiKeyData | undefined, instanceId: string): void {
  if (apiKey && !ApiKeyService.instanceAllowed(apiKey.instanceIds, instanceId)) {
    throw new OmniError({
      code: ERROR_CODES.FORBIDDEN,
      message: 'API key does not have access to this instance',
      context: { instanceId },
      recoverable: false,
    });
  }
}

/** Resolve the Slack plugin, refusing early when the instance is not Slack. */
async function getSlackPlugin(
  c: { get: (k: 'services' | 'channelRegistry' | 'apiKey') => unknown },
  instanceId: string,
): Promise<SlackCapablePlugin> {
  checkInstanceAccess(c.get('apiKey') as ApiKeyData | undefined, instanceId);

  const services = c.get('services') as { instances: { getById: (id: string) => Promise<{ channel: string }> } };
  const registry = c.get('channelRegistry') as { get: (ch: ChannelType) => unknown } | null | undefined;

  const instance = await services.instances.getById(instanceId);

  if (instance.channel !== 'slack') {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Instance ${instanceId} is a ${instance.channel} instance; these endpoints are Slack-only`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  if (!registry) {
    throw new OmniError({
      code: ERROR_CODES.CHANNEL_NOT_CONNECTED,
      message: 'Channel registry not available',
      recoverable: false,
    });
  }

  const plugin = registry.get('slack' as ChannelType) as SlackCapablePlugin | undefined;
  if (!plugin) {
    throw new OmniError({
      code: ERROR_CODES.CHANNEL_NOT_CONNECTED,
      message: 'Slack plugin not registered',
      recoverable: false,
    });
  }

  return plugin;
}

/**
 * POST /slack/dm/open — resolve the DM channel for a user.
 *
 * Idempotent on Slack's side: calling it for an existing DM returns the same
 * channel rather than opening a second one.
 */
slackRoutes.post('/dm/open', zValidator('json', openDmSchema), async (c) => {
  const { instanceId, userId } = c.req.valid('json');
  const plugin = await getSlackPlugin(c, instanceId);

  if (typeof plugin.openDirectMessage !== 'function') {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: 'Slack plugin does not implement openDirectMessage',
      recoverable: false,
    });
  }

  try {
    const channelId = await plugin.openDirectMessage(instanceId, userId);
    return c.json({ success: true, data: { userId, channelId } });
  } catch (error) {
    throw new OmniError({
      code: ERROR_CODES.CHANNEL_SEND_FAILED,
      message: error instanceof Error ? error.message : String(error),
      recoverable: true,
    });
  }
});

/**
 * GET /slack/search — full-text search.
 *
 * Needs an instance in `user` auth mode: search.messages requires the
 * `search:read` user scope and no bot token can hold it. The plugin throws
 * for a bot-mode instance, and that error is surfaced rather than converted
 * into an empty result — empty would read as "nothing matched".
 */
slackRoutes.get('/search', zValidator('query', searchSchema), async (c) => {
  const { instanceId, query, count, page } = c.req.valid('query');
  const plugin = await getSlackPlugin(c, instanceId);

  if (typeof plugin.searchMessages !== 'function') {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: 'Slack plugin does not implement searchMessages',
      recoverable: false,
    });
  }

  try {
    const matches = await plugin.searchMessages(instanceId, query, { count, page });
    return c.json({
      data: matches,
      meta: {
        count: matches.length,
        page,
        // Slack applies the authorizing user's own search preferences, so this
        // is that person's view of the workspace, not a neutral index query.
        scope: 'authorizing-user',
      },
    });
  } catch (error) {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: error instanceof Error ? error.message : String(error),
      recoverable: false,
    });
  }
});
