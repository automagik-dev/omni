/**
 * ASC platform Flow channel capabilities.
 *
 * The poll body (`resposta`) and `/callbackFlowMsg` carry a STRING, so text
 * alone can leave that way. Everything richer — media, location, contact card,
 * real buttons/list — goes through `POST /mensagem`, the one endpoint that
 * injects content into a running atendimento (`utils/outbound.ts`).
 *
 * Inbound media arrives as a file NAME in `chatInput`, with the bytes fetched
 * off `/atendimento` (`utils/media.ts`).
 */

import { DEFAULT_CAPABILITIES } from '@omni/channel-sdk';
import type { ChannelCapabilities } from '@omni/channel-sdk';

export const ASC_FLOW_CAPABILITIES: ChannelCapabilities = {
  ...DEFAULT_CAPABILITIES,
  canSendText: true,
  /** `POST /mensagem` with `url_arquivo` or `base64_arquivo`. */
  canSendMedia: true,
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
  /** `POST /mensagem` with `cartao_contato` (nome/telefone/email). */
  canSendContact: true,
  /** `POST /mensagem` with `localizacao` (latitude/longitude/endereco). */
  canSendLocation: true,
  canSendSticker: false,
  /** URA options on `POST /mensagem` (`ura_opcoes` + `forcar_botoes`). */
  canSendButtons: true,
  canHandleGroups: false,
  canHandleBroadcast: false,
  canHandleDMs: true,
  canStreamResponse: false,
  maxMessageLength: 4096,
  /**
   * The tighter of the two directions: inbound is capped by
   * `createDownloadGuard` (50 MB), outbound by `OUTBOUND_MEDIA_MAX_BYTES`
   * (16 MB, Meta's ceiling — the platform is a BSP on top of it).
   */
  maxFileSize: 16 * 1024 * 1024,
  /**
   * The platform hands whatever WhatsApp delivered, so the families are open:
   * the inbound resolver types by `content-type` family and files anything
   * else as a document, and outbound sends the MIME type it is given.
   */
  supportedMediaTypes: [
    { mimeType: 'image/*', maxSize: 16 * 1024 * 1024 },
    { mimeType: 'audio/*', maxSize: 16 * 1024 * 1024 },
    { mimeType: 'video/*', maxSize: 16 * 1024 * 1024 },
    { mimeType: 'application/*', maxSize: 16 * 1024 * 1024 },
  ],
};
