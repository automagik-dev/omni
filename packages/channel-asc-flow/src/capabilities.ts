/**
 * ASC platform Flow channel capabilities.
 *
 * Text-only by design: the flow's `api_rest` node hands us `chatInput`, a
 * string. Media in either direction is out of scope for v1 (see the README).
 */

import { DEFAULT_CAPABILITIES } from '@omni/channel-sdk';
import type { ChannelCapabilities } from '@omni/channel-sdk';

export const ASC_FLOW_CAPABILITIES: ChannelCapabilities = {
  ...DEFAULT_CAPABILITIES,
  canSendText: true,
  canSendMedia: false,
  canSendReaction: false,
  /** `POST /sendIndicador {tipo: 1}`. */
  canSendTyping: true,
  canReceiveReadReceipts: false,
  canReceiveDeliveryReceipts: false,
  canEditMessage: false,
  canDeleteMessage: false,
  canReplyToMessage: true,
  canForwardMessage: false,
  /** `POST /transferirHumano` into the configured queue. */
  canHandoff: true,
  canCloseContact: false,
  canSendContact: false,
  canSendLocation: false,
  canSendSticker: false,
  /** URA options on `POST /mensagem` (`ura_opcoes` + `forcar_botoes`). */
  canSendButtons: true,
  canHandleGroups: false,
  canHandleBroadcast: false,
  canHandleDMs: true,
  canStreamResponse: false,
  maxMessageLength: 4096,
  maxFileSize: 0,
  supportedMediaTypes: [],
};
