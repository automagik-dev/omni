/**
 * Hermes — HSM (template) sender.
 *
 * Templates are the only message type allowed outside the 24h messaging
 * window. Hermes requires the Meta template `namespace` (per-line, stored
 * on the instance as `hermesTemplateNamespace`) plus a deterministic
 * language policy: `language: { policy: 'deterministic', code }`.
 * v1 supports body text parameters only.
 */

import type { HermesClient } from '../client';
import type { HermesOutboundMessage, HermesSendResponse, HermesTemplatePayload } from '../types';
import { toHermesPhone } from '../utils/identity';

export interface SendTemplateOptions {
  namespace: string;
  name: string;
  /** BCP-ish Meta language code, e.g. 'pt_BR'. */
  language: string;
  bodyParameters?: string[];
}

export async function sendTemplate(
  client: HermesClient,
  to: string,
  opts: SendTemplateOptions,
  replyTo?: string,
): Promise<HermesSendResponse> {
  const template: HermesTemplatePayload = {
    namespace: opts.namespace,
    language: { policy: 'deterministic', code: opts.language },
    name: opts.name,
  };
  if (opts.bodyParameters && opts.bodyParameters.length > 0) {
    template.components = [
      {
        type: 'body',
        parameters: opts.bodyParameters.map((text) => ({ type: 'text', text })),
      },
    ];
  }

  const payload: HermesOutboundMessage = {
    to: toHermesPhone(to),
    recipient_type: 'individual',
    type: 'template',
    template,
  };
  if (replyTo) payload.context = { message_id: replyTo };
  return client.sendMessage(payload);
}
