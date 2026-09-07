/**
 * @omni/channel-harness — E2E Agent Test Harness Channel (issue #953)
 *
 * A channel whose platform IS the test: drives inbound conversation turns,
 * captures every outbound verbatim (components included), and simulates taps.
 * Auto-discovered by @omni/channel-sdk scanner.
 */

import { channelRegistry } from '@omni/channel-sdk';
import { HarnessChannelPlugin } from './plugin';

const plugin = new HarnessChannelPlugin();
channelRegistry.register(plugin);

export default plugin;

export { HarnessChannelPlugin } from './plugin';
export { HarnessTranscriptStore } from './transcript-store';
export {
  DEFAULT_HARNESS_PROFILE,
  HarnessCapabilityProfileSchema,
  HarnessSayRequestSchema,
  HarnessTapRequestSchema,
} from './types';
export type {
  HarnessCapabilityProfile,
  HarnessInboundEntry,
  HarnessOutboundEntry,
  HarnessSayRequest,
  HarnessTapRequest,
  HarnessTranscript,
  HarnessTranscriptEntry,
  HarnessViolation,
} from './types';
