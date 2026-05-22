/**
 * @omni/channel-a2a — A2A Protocol Server Channel
 *
 * Exposes Omni instances as A2A-compatible agents.
 * Auto-discovered by @omni/channel-sdk scanner.
 */

import { channelRegistry } from '@omni/channel-sdk';
import { A2AChannelPlugin } from './plugin';

const plugin = new A2AChannelPlugin();
channelRegistry.register(plugin);

export default plugin;

export { A2AChannelPlugin } from './plugin';
export { A2AStreamStore } from './stream-store';
export { A2ATaskStore } from './task-store';
export { buildAgentCard } from './agent-card';
export { handleA2ARequest } from './a2a-handler';
export type * from './types';
