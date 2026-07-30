/**
 * Meta WhatsApp Cloud — contact card sender.
 *
 * Meta's `contacts` payload is an array of contact records, each with a
 * `name.formatted_name` (required) plus optional `phones[]`, `emails[]`,
 * `addresses[]`, etc. We accept a simplified input shape and expand it.
 *
 * Reference:
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages#contacts-object
 */

import type { MetaWhatsAppClient } from '../client';
import type { MetaOutboundMessage, MetaSendResponse } from '../types';
import { toMetaPhone } from '../utils/identity';

export interface ContactInput {
  /** Display name (becomes formatted_name). */
  name: string;
  /** Optional list of phone numbers (any format — normalized to digits). */
  phones?: string[];
  /** Optional list of email addresses. */
  emails?: string[];
}

interface MetaContactPhone {
  phone: string;
  type?: 'CELL' | 'HOME' | 'WORK';
  wa_id?: string;
}

interface MetaContactEmail {
  email: string;
  type?: 'HOME' | 'WORK';
}

interface MetaContactRecord {
  name: { formatted_name: string; first_name?: string };
  phones?: MetaContactPhone[];
  emails?: MetaContactEmail[];
}

function buildContactRecord(input: ContactInput): MetaContactRecord {
  const record: MetaContactRecord = {
    name: { formatted_name: input.name, first_name: input.name },
  };
  if (input.phones && input.phones.length > 0) {
    record.phones = input.phones.map((raw) => {
      const digits = toMetaPhone(raw);
      const entry: MetaContactPhone = { phone: raw, type: 'CELL' };
      if (digits) entry.wa_id = digits;
      return entry;
    });
  }
  if (input.emails && input.emails.length > 0) {
    record.emails = input.emails.map((email) => ({ email, type: 'WORK' }));
  }
  return record;
}

export async function sendContact(
  client: MetaWhatsAppClient,
  to: string,
  contacts: ContactInput[],
  replyTo?: string,
): Promise<MetaSendResponse> {
  const payload: MetaOutboundMessage = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toMetaPhone(to),
    type: 'contacts',
    contacts: contacts.map(buildContactRecord),
  };
  if (replyTo) payload.context = { message_id: replyTo };
  return client.sendMessage(payload);
}
