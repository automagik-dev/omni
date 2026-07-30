/**
 * Meta WhatsApp Cloud — interactive message sender (session buttons/lists).
 *
 * Maps the channel-agnostic `content.buttons` contract ({ text, data?, url? })
 * onto Meta's in-session interactive types. Meta's constraints drive the shape:
 *   - `interactive.button` — up to 3 reply buttons (title ≤ 20 chars, id ≤ 256)
 *   - `interactive.list`   — 4-10 options become a single-section list
 *                            (row title ≤ 24 chars); >10 rows is a Meta hard
 *                            limit, the overflow is dropped (caller logs)
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

export interface InteractiveButton {
  text: string;
  /** Callback payload (becomes the reply button / list row id). */
  data?: string;
  /** Link button URL — expressed via cta_url when it is the only button. */
  url?: string;
}

const MAX_REPLY_BUTTONS = 3;
const MAX_LIST_ROWS = 10;
const MAX_BUTTON_TITLE = 20;
const MAX_ROW_TITLE = 24;
const MAX_ID = 256;

const truncate = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

function buttonId(btn: InteractiveButton, index: number): string {
  return (btn.data ?? btn.text ?? `btn_${index}`).slice(0, MAX_ID);
}

/** Result of mapping the agnostic buttons onto a Meta interactive payload. */
export interface InteractivePlan {
  interactive: Record<string, unknown> | null;
  /** Body text, possibly extended with URL fallback lines. */
  body: string;
  /** Rows dropped beyond Meta's list limit — caller should log these. */
  droppedRows: number;
}

/**
 * Pure mapping step — exported for tests and for the plugin to log drops.
 */
export function planInteractive(
  bodyText: string,
  buttons: InteractiveButton[],
  listButtonLabel: string,
): InteractivePlan {
  const replyButtons = buttons.filter((b) => !b.url);
  const urlButtons = buttons.filter((b) => b.url);

  // Single URL button and nothing else → cta_url is the exact fit.
  const soleCta = replyButtons.length === 0 && urlButtons.length === 1 ? urlButtons[0] : undefined;
  if (soleCta) {
    return {
      interactive: {
        type: 'cta_url',
        body: { text: bodyText },
        action: {
          name: 'cta_url',
          parameters: { display_text: truncate(soleCta.text, MAX_BUTTON_TITLE), url: soleCta.url },
        },
      },
      body: bodyText,
      droppedRows: 0,
    };
  }

  // Any other URL buttons cannot render in-session — fold them into the body.
  let body = bodyText;
  if (urlButtons.length > 0) {
    const lines = urlButtons.map((b) => `${b.text}: ${b.url}`);
    body = body ? `${body}\n\n${lines.join('\n')}` : lines.join('\n');
  }

  if (replyButtons.length === 0) {
    return { interactive: null, body, droppedRows: 0 };
  }

  if (replyButtons.length <= MAX_REPLY_BUTTONS) {
    return {
      interactive: {
        type: 'button',
        body: { text: body },
        action: {
          buttons: replyButtons.map((b, i) => ({
            type: 'reply',
            reply: { id: buttonId(b, i), title: truncate(b.text, MAX_BUTTON_TITLE) },
          })),
        },
      },
      body,
      droppedRows: 0,
    };
  }

  const rows = replyButtons.slice(0, MAX_LIST_ROWS);
  return {
    interactive: {
      type: 'list',
      body: { text: body },
      action: {
        button: truncate(listButtonLabel, MAX_BUTTON_TITLE),
        sections: [
          {
            rows: rows.map((b, i) => ({ id: buttonId(b, i), title: truncate(b.text, MAX_ROW_TITLE) })),
          },
        ],
      },
    },
    body,
    droppedRows: replyButtons.length - rows.length,
  };
}

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
): Promise<{ response: MetaSendResponse; droppedRows: number }> {
  const plan = planInteractive(bodyText, buttons, listButtonLabel);

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
