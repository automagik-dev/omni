import { type ChannelCapabilities, DEFAULT_CAPABILITIES } from '@omni/channel-sdk';
export const evolutionCapabilities: ChannelCapabilities = {
  ...DEFAULT_CAPABILITIES,
  canSendMedia: true,
  canSendSticker: true,
  canSendContact: true,
  canSendLocation: true,
  canHandleGroups: true,
  canHandleDMs: true,
  canReceiveDeliveryReceipts: true,
  canReceiveReadReceipts: true,
  maxMessageLength: 65536,
  supportedMediaTypes: [
    { mimeType: 'image/*' },
    { mimeType: 'audio/*' },
    { mimeType: 'video/*' },
    { mimeType: 'application/*' },
  ],
  events: {
    emits: [
      'instance.connected',
      'instance.disconnected',
      'instance.qr_code',
      'message.received',
      'message.sent',
      'message.delivered',
      'message.read',
      'message.failed',
    ],
    edits: false,
    deletes: false,
    idempotency: true,
  },
};
