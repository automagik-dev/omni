/**
 * @omni/channel-webchat — PROTOTYPE web chat channel (HTTP POST in, SSE out).
 * Auto-discovered by @omni/channel-sdk scanner.
 */

import { channelRegistry } from '@omni/channel-sdk';
import { WebchatChannelPlugin } from './plugin';

const plugin = new WebchatChannelPlugin();
channelRegistry.register(plugin);

export default plugin;

export { WebchatChannelPlugin } from './plugin';
export { VisitorIdSchema, WebchatSendRequestSchema } from './types';
export type { WebchatOutboundEvent, WebchatSendRequest } from './types';
