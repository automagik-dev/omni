import { ZapiWebPlugin, zapiCapabilities } from '@omni/channel-zapi-web';
import type { ChannelType } from '@omni/core/types';
export class ZapiOmniPlugin extends ZapiWebPlugin {
  override readonly id: ChannelType = 'zapi-omni';
  override readonly name = 'Z-API Omni (Official)';
  override readonly capabilities = zapiCapabilities(true);
  protected override expectedDriver(): 'omni' {
    return 'omni';
  }
}
export default new ZapiOmniPlugin();
