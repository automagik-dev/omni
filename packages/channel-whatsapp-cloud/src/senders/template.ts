/**
 * Meta WhatsApp Cloud — HSM (template) sender.
 *
 * Templates are the only message type allowed outside the 24h messaging
 * window. The actual `components[]` payload (header media / body variables
 * / button parameters) is built by `client.buildTemplatePayload()`.
 */

import type { MetaWhatsAppClient } from '../client';
import type { MetaOutboundMessage, MetaSendResponse } from '../types';
import { toMetaPhone } from '../utils/identity';

export interface SendTemplateButton {
  sub_type: 'quick_reply' | 'url' | 'copy_code';
  index: number;
  payload?: string;
  text?: string;
}

export interface SendTemplateHeaderMedia {
  type: 'image' | 'video' | 'document';
  link?: string;
  id?: string;
  filename?: string;
}

export async function sendTemplate(
  client: MetaWhatsAppClient,
  to: string,
  templateName: string,
  language: string,
  bodyParameters?: string[],
  headerMedia?: SendTemplateHeaderMedia,
  buttonParameters?: SendTemplateButton[],
  replyTo?: string,
): Promise<MetaSendResponse> {
  const template = client.buildTemplatePayload({
    name: templateName,
    language,
    bodyParameters,
    headerMedia,
    buttonParameters,
  });

  const payload: MetaOutboundMessage = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toMetaPhone(to),
    type: 'template',
    template,
  };
  if (replyTo) payload.context = { message_id: replyTo };
  return client.sendMessage(payload);
}
