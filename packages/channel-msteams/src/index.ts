/**
 * Microsoft Teams Channel Plugin for Omni v2
 *
 * Provides Microsoft Teams messaging via the Bot Framework SDK (botbuilder).
 *
 * @example
 * ```typescript
 * import msteamsPlugin from '@omni/channel-msteams';
 *
 * // Plugin is auto-discovered by channel-sdk scanner
 * // Or manually register:
 * registry.register(msteamsPlugin);
 * ```
 */

import { MsTeamsPlugin } from './plugin';

const plugin = new MsTeamsPlugin();
export default plugin;

export { MsTeamsPlugin } from './plugin';
export { MSTEAMS_CAPABILITIES } from './capabilities';
export type { MsTeamsConfig, MsTeamsAppType } from './types';
