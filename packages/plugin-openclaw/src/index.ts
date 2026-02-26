import { omniPlugin } from './channel.js';
import { setOmniRuntime } from './runtime.js';
import type { OpenClawPluginApi } from './types.js';

const plugin = {
  id: 'omni',
  name: 'Omni',
  description: 'Omni v2 multichannel messaging (WhatsApp, Discord, Slack, Telegram)',
  register(api: OpenClawPluginApi) {
    setOmniRuntime(api.runtime);
    api.registerChannel({ plugin: omniPlugin });
  },
};

export default plugin;
