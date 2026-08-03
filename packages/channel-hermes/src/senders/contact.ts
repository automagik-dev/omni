/**
 * Hermes — contact card sender.
 *
 * `contacts` is the Cloud-API contact array (Hermes passes it through).
 * We accept a simplified input shape and expand it, mirroring the
 * whatsapp-business sibling.
 */

import type { HermesClient } from '../client';
import type { HermesContactCardInput, HermesContactRecord, HermesOutboundMessage, HermesSendResponse } from '../types';
import { toHermesPhone } from '../utils/identity';

type HermesContactPhone = NonNullable<HermesContactRecord['phones']>[number];

function buildContactRecord(input: HermesContactCardInput): HermesContactRecord {
  const record: HermesContactRecord = {
    name: { formatted_name: input.name, first_name: input.name },
  };
  if (input.phones && input.phones.length > 0) {
    record.phones = input.phones.map((raw) => {
      const digits = toHermesPhone(raw);
      const entry: HermesContactPhone = { phone: raw, type: 'CELL' };
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
  client: HermesClient,
  to: string,
  contacts: HermesContactCardInput[],
  replyTo?: string,
): Promise<HermesSendResponse> {
  const payload: HermesOutboundMessage = {
    to: toHermesPhone(to),
    recipient_type: 'individual',
    type: 'contacts',
    contacts: contacts.map(buildContactRecord),
  };
  if (replyTo) payload.context = { message_id: replyTo };
  return client.sendMessage(payload);
}
