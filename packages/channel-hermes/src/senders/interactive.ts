/**
 * Hermes — interactive message senders (reply buttons + list).
 *
 * Shapes match the Hermes spec ("Interactive Button Message" /
 * "Interactive List Message"), which mirror the Cloud API interactive
 * object.
 */

import type { HermesClient } from '../client';
import type {
  HermesInteractiveButtonPayload,
  HermesInteractiveListPayload,
  HermesInteractivePayload,
  HermesOutboundMessage,
  HermesSendResponse,
} from '../types';
import { toHermesPhone } from '../utils/identity';

export interface InteractiveButton {
  id: string;
  title: string;
}

export interface InteractiveListSection {
  title?: string;
  rows: Array<{ id: string; title: string; description?: string }>;
}

export interface SendInteractiveListOptions {
  bodyText: string;
  /** Label on the list-opener button. */
  buttonText: string;
  sections: InteractiveListSection[];
  headerText?: string;
  footerText?: string;
}

export async function sendInteractiveButtons(
  client: HermesClient,
  to: string,
  bodyText: string,
  buttons: InteractiveButton[],
  replyTo?: string,
): Promise<HermesSendResponse> {
  const interactive: HermesInteractiveButtonPayload = {
    type: 'button',
    body: { text: bodyText },
    action: {
      buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
    },
  };
  const payload: HermesOutboundMessage = {
    to: toHermesPhone(to),
    recipient_type: 'individual',
    type: 'interactive',
    interactive,
  };
  if (replyTo) payload.context = { message_id: replyTo };
  return client.sendMessage(payload);
}

/**
 * Send a pre-built Cloud API `interactive` object (the output of the shared
 * `planInteractive` mapper) — button, list, or cta_url.
 */
export async function sendPlannedInteractive(
  client: HermesClient,
  to: string,
  interactive: Record<string, unknown>,
  replyTo?: string,
): Promise<HermesSendResponse> {
  const payload: HermesOutboundMessage = {
    to: toHermesPhone(to),
    recipient_type: 'individual',
    type: 'interactive',
    interactive: interactive as unknown as HermesInteractivePayload,
  };
  if (replyTo) payload.context = { message_id: replyTo };
  return client.sendMessage(payload);
}

/**
 * Ask the user to share their location — renders WhatsApp's native
 * "Send location" button under the body text. The shared location arrives
 * as a regular inbound `location` message on the webhook.
 */
export async function sendLocationRequest(
  client: HermesClient,
  to: string,
  bodyText: string,
  replyTo?: string,
): Promise<HermesSendResponse> {
  const payload: HermesOutboundMessage = {
    to: toHermesPhone(to),
    recipient_type: 'individual',
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

export async function sendInteractiveList(
  client: HermesClient,
  to: string,
  opts: SendInteractiveListOptions,
  replyTo?: string,
): Promise<HermesSendResponse> {
  const interactive: HermesInteractiveListPayload = {
    type: 'list',
    body: { text: opts.bodyText },
    action: {
      button: opts.buttonText,
      sections: opts.sections.map((s) => ({
        ...(s.title ? { title: s.title } : {}),
        rows: s.rows,
      })),
    },
  };
  if (opts.headerText) interactive.header = { type: 'text', text: opts.headerText };
  if (opts.footerText) interactive.footer = { text: opts.footerText };

  const payload: HermesOutboundMessage = {
    to: toHermesPhone(to),
    recipient_type: 'individual',
    type: 'interactive',
    interactive,
  };
  if (replyTo) payload.context = { message_id: replyTo };
  return client.sendMessage(payload);
}
