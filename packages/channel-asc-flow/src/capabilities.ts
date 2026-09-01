/**
 * ASC platform Flow channel capabilities.
 *
 * Outbound is text-only: the answer goes back through the api_rest poll body
 * (`resposta`) and `/callbackFlowMsg`, both of which carry a string. Sending
 * media is out of scope (see the README).
 *
 * Inbound DOES carry media. The flow hands us a file NAME in `chatInput` and
 * the bytes are fetched off `/atendimento` (`utils/media.ts`), so audio, image,
 * video and documents reach Omni's media pipeline. Hence `canSendMedia: false`
 * next to a populated `supportedMediaTypes` — the list describes what the
 * channel can RECEIVE.
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
  /** Inbound only — the `createDownloadGuard` default the resolver enforces. */
  maxFileSize: 50 * 1024 * 1024,
  /**
   * What the channel can RECEIVE (outbound media is not supported). The
   * platform hands whatever WhatsApp delivered, so the families are open: the
   * resolver types by `content-type` family and files anything else as a
   * document.
   */
  supportedMediaTypes: [
    { mimeType: 'image/*', maxSize: 50 * 1024 * 1024 },
    { mimeType: 'audio/*', maxSize: 50 * 1024 * 1024 },
    { mimeType: 'video/*', maxSize: 50 * 1024 * 1024 },
    { mimeType: 'application/*', maxSize: 50 * 1024 * 1024 },
  ],
};
