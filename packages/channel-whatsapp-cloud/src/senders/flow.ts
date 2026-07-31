/**
 * Meta WhatsApp Cloud — WhatsApp Flow sender.
 *
 * Sends an `interactive.flow` message: body text + a CTA button that opens a
 * published (or, with `draft: true`, an unpublished) Flow. The user's answers
 * come back on the webhook as `interactive.nfm_reply` with `response_json`,
 * correlated by the `flow_token` echoed back verbatim.
 *
 * Supports both `flow_action: navigate` (static flows) and `data_exchange`
 * (endpoint-backed dynamic flows — the omni-hosted encrypted data endpoint
 * resolves each screen; see handlers/flow-data.ts).
 */

import type { WhatsAppFlowSend } from '@omni/core/schemas';
import type { MetaWhatsAppClient } from '../client';
import { buildFlowToken } from '../flows/resolver';
import type { MetaOutboundMessage, MetaSendResponse } from '../types';
import { toMetaPhone } from '../utils/identity';

export interface SendFlowResult {
  response: MetaSendResponse;
  /** The token that will come back on the nfm_reply — persist to correlate. */
  flowToken: string;
}

export async function sendFlow(
  client: MetaWhatsAppClient,
  to: string,
  flow: WhatsAppFlowSend,
  replyTo?: string,
): Promise<SendFlowResult> {
  // Structured token (`omni.<flowRef>.<uuid>`) — the data endpoint recovers
  // the flow ref from it, since Meta's decrypted payload has no flow id.
  // Caller-supplied tokens pass through opaque.
  const flowRef = flow.flowId ?? flow.flowName ?? 'unknown';
  const flowToken = flow.flowToken ?? buildFlowToken(flowRef);
  const flowAction = flow.flowAction ?? 'navigate';

  const parameters: Record<string, unknown> = {
    flow_message_version: '3',
    flow_token: flowToken,
    flow_cta: flow.cta,
    flow_action: flowAction,
    ...(flow.flowId ? { flow_id: flow.flowId } : { flow_name: flow.flowName }),
    ...(flow.draft ? { mode: 'draft' } : {}),
  };
  // navigate: entry screen is required client-side; data_exchange: the INIT
  // call to the endpoint decides the first screen, so no payload is sent.
  if (flow.screen && flowAction === 'navigate') {
    parameters.flow_action_payload = {
      screen: flow.screen,
      ...(flow.data && Object.keys(flow.data).length > 0 ? { data: flow.data } : {}),
    };
  }

  const payload: MetaOutboundMessage = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toMetaPhone(to),
    type: 'interactive',
    interactive: {
      type: 'flow',
      ...(flow.headerText ? { header: { type: 'text', text: flow.headerText } } : {}),
      body: { text: flow.bodyText },
      ...(flow.footerText ? { footer: { text: flow.footerText } } : {}),
      action: { name: 'flow', parameters },
    },
  };
  if (replyTo) payload.context = { message_id: replyTo };

  return { response: await client.sendMessage(payload), flowToken };
}
