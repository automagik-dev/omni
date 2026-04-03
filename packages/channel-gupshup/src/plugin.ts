/**
 * Gupshup channel plugin — stub
 *
 * Full implementation in Group 3 (plugin class + webhook handler).
 * This stub satisfies the type contract so Group 1 typecheck passes.
 */

import { BaseChannelPlugin } from '@omni/channel-sdk';
import type { InstanceConfig, OutgoingMessage, SendResult } from '@omni/channel-sdk';
import { GUPSHUP_CAPABILITIES } from './capabilities';

export class GupshupPlugin extends BaseChannelPlugin {
  readonly id = 'gupshup' as const;
  readonly name = 'Gupshup WhatsApp BSP';
  readonly version = '1.0.0';
  readonly capabilities = GUPSHUP_CAPABILITIES;

  async connect(_instanceId: string, _config: InstanceConfig): Promise<void> {
    throw new Error('GupshupPlugin.connect() not yet implemented — see Group 3');
  }

  async disconnect(_instanceId: string): Promise<void> {
    // no-op stub
  }

  async sendMessage(_instanceId: string, _message: OutgoingMessage): Promise<SendResult> {
    throw new Error('GupshupPlugin.sendMessage() not yet implemented — see Group 4');
  }
}
