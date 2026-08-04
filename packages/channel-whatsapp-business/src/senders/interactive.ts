/**
 * Meta WhatsApp Cloud — interactive message sender (session buttons/lists).
 *
 * Maps the channel-agnostic `content.buttons` contract
 * ({ text, data?, url?, description? }) onto Meta's in-session interactive
 * types. Meta's constraints drive the shape:
 *   - `interactive.button` — up to 3 reply buttons (title ≤ 20 chars, id ≤ 256)
 *   - `interactive.list`   — 4-10 options become a single-section list
 *                            (row title ≤ 24 chars, row description ≤ 72,
 *                            section title ≤ 24); >10 rows is a Meta hard
 *                            limit, the overflow is dropped (caller logs)
 *   - a list is also chosen for ≤3 options when the caller asks for one
 *     (`forceList`) or supplies presentation that only lists can render
 *     (a row `description`, or a `sectionTitle`) — rendering reply buttons
 *     there would drop that content silently
 *   - `interactive.cta_url`— exactly one URL button (session messages cannot
 *                            carry arbitrary URL buttons; cta_url is the only
 *                            in-session link affordance)
 *   - URL buttons that cannot be expressed (mixed with reply buttons, or more
 *     than one) are appended to the body as `label: url` lines so no
 *     information is silently lost.
 *
 * Interactive messages only deliver inside the 24h customer-service window —
 * outside it Meta rejects them (use an HSM template with buttons instead).
 */

import type { MetaWhatsAppClient } from '../client';
import type { MetaOutboundMessage, MetaSendResponse } from '../types';
import { toMetaPhone } from '../utils/identity';

import {
  type InteractiveButton,
  type InteractiveListOptions,
  type InteractivePlan,
  planInteractive,
} from '@omni/channel-sdk';

// The planner moved to @omni/channel-sdk (shared with channel-hermes, which
// proxies the same Cloud API interactive shapes through the Mutant gateway).
// Re-exported here so existing importers and tests keep their paths.
export { planInteractive };
export type { InteractiveButton, InteractiveListOptions, InteractivePlan };

/**
 * Ask the user to share their location — renders WhatsApp's native
 * "Send location" button under the body text. The shared location arrives
 * as a regular inbound `location` message on the webhook.
 */
export async function sendLocationRequest(
  client: MetaWhatsAppClient,
  to: string,
  bodyText: string,
  replyTo?: string,
): Promise<MetaSendResponse> {
  const payload: MetaOutboundMessage = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toMetaPhone(to),
    type: 'interactive',
    interactive: {
      type: 'location_request_message',
      body: { text: bodyText },
      action: { name: 'send_location' },
    },
  };
  if (replyTo) payload.context = { message_id: replyTo };
  return client.sendMessage(payload);
}

/**
 * Send body text with buttons as the best-fitting Meta interactive type.
 * Falls back to a plain text send when nothing interactive remains after
 * mapping (e.g. only URL buttons folded into the body).
 */
export async function sendInteractive(
  client: MetaWhatsAppClient,
  to: string,
  bodyText: string,
  buttons: InteractiveButton[],
  replyTo?: string,
  listButtonLabel = 'Options',
  listOptions: InteractiveListOptions = {},
): Promise<{ response: MetaSendResponse; droppedRows: number }> {
  const plan = planInteractive(bodyText, buttons, listButtonLabel, listOptions);

  const payload: MetaOutboundMessage = plan.interactive
    ? {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toMetaPhone(to),
        type: 'interactive',
        interactive: plan.interactive,
      }
    : {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toMetaPhone(to),
        type: 'text',
        text: { body: plan.body, preview_url: false },
      };
  if (replyTo) payload.context = { message_id: replyTo };

  return { response: await client.sendMessage(payload), droppedRows: plan.droppedRows };
}
