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
