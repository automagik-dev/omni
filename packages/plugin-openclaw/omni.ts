// OpenClaw plugin entry point — filename must match manifest id ("omni")
import { omniPlugin } from './src/channel.js';
import { setOmniRuntime } from './src/runtime.js';
import type { OpenClawPluginApi } from './src/types.js';

export default function register(api: OpenClawPluginApi) {
  setOmniRuntime(api.runtime);
  api.registerChannel({ plugin: omniPlugin });
}
