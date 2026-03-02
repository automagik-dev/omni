/**
 * @omni/channel-internal — Internal Agent-to-Agent Routing Channel
 *
 * Enables chaining agent responses as inputs to another instance's agent.
 * Auto-discovered by @omni/channel-sdk scanner.
 */

import { channelRegistry } from '@omni/channel-sdk';
import { InternalChannelPlugin } from './plugin';

const plugin = new InternalChannelPlugin();
channelRegistry.register(plugin);

export default plugin;

export { InternalChannelPlugin } from './plugin';
