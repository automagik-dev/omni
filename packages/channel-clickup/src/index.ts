/**
 * @omni/channel-clickup — ClickUp API v2 channel (issue #1413)
 *
 * Transport-less and non-messaging: validates a personal API token on connect
 * and exposes task actions. Registered eagerly like channel-harness so a
 * bundled distribution has the plugin before the API reads the registry.
 *
 * NOTE: the API route and OpenAPI schema import `ClickUpActionRequestSchema`
 * from the `@omni/channel-clickup/types` subpath rather than this entry. A
 * runtime import of this module would self-register the plugin before the
 * plugin loader runs, and `loadChannelPlugins` skips filesystem discovery
 * whenever anything is already registered — which would silently drop every
 * other channel in monorepo dev (the channel-harness precedent).
 */

import { channelRegistry } from '@omni/channel-sdk';
import { ClickUpChannelPlugin } from './plugin';

const plugin = new ClickUpChannelPlugin();
channelRegistry.register(plugin);

export default plugin;

export { ClickUpChannelPlugin } from './plugin';
export type { ClickUpPluginOptions } from './plugin';
export { CLICKUP_CHANNEL_CAPABILITIES, CLICKUP_TASK_CAPABILITIES } from './capabilities';
export type { ClickUpTaskCapabilities } from './capabilities';
export { ClickUpApiClient } from './client';
export type { ClickUpClientOptions } from './client';
export { ClickUpApiError, ClickUpError } from './errors';
export type { ClickUpErrorCode } from './errors';
export {
  CLICKUP_DEFAULT_BASE_URL,
  CLICKUP_OPERATIONS,
  ClickUpActionRequestSchema,
  ClickUpCommentResponseSchema,
  ClickUpConnectOptionsSchema,
  ClickUpTaskResponseSchema,
  ClickUpTasksResponseSchema,
  ClickUpTeamsResponseSchema,
} from './types';
export type {
  ClickUpActionRequest,
  ClickUpActionResult,
  ClickUpActionRunner,
  ClickUpComment,
  ClickUpConnectOptions,
  ClickUpCredentials,
  ClickUpOperation,
  ClickUpTask,
  ClickUpTaskList,
  ClickUpTeam,
} from './types';
