/**
 * Contact (vCard) message sender
 */

import type { AnyMessageContent, WASocket } from 'baileys';

/**
 * Contact data
 */
export interface ContactData {
  name: string;
  phone?: string;
  email?: string;
  organization?: string;
}

/**
 * Compute the WhatsApp ID (waid) from a phone number's digits.
 *
 * Brazilian 9th-digit rules:
 * - DDDs 11–30 (SP, RJ, metro): the 9 is part of the real number, WhatsApp
 *   stores the JID WITH it → keep the 13-digit format.
 * - DDDs 31+ (MG, interior): WhatsApp stores the JID WITHOUT the leading 9
 *   → strip to 12 digits.
 *
 * See: Evolution API #1428, #357; Baileys #156
 */
export function computeWaid(digits: string): string {
  if (digits.length === 13 && digits.startsWith('55') && digits.charAt(4) === '9') {
    const ddd = Number(digits.slice(2, 4));
    // DDDs 31+ store without the 9th digit in WhatsApp
    if (ddd >= 31) {
      return digits.slice(0, 4) + digits.slice(5);
    }
  }
  return digits;
}

/**
 * Build a vCard string from contact data
 */
export function buildVCard(contact: ContactData): string {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${contact.name}`, `N:;${contact.name};;;`];

  if (contact.phone) {
    // Clean phone number — keep only digits (strip + and formatting)
    const digits = contact.phone.replace(/[^\d]/g, '');
    const waid = computeWaid(digits);
    lines.push(`TEL;type=CELL;type=VOICE;waid=${waid}:${contact.phone}`);
  }

  if (contact.email) {
    lines.push(`EMAIL;type=INTERNET:${contact.email}`);
  }

  if (contact.organization) {
    lines.push(`ORG:${contact.organization}`);
  }

  lines.push('END:VCARD');
  return lines.join('\n');
}

/**
 * Build contact message content
 */
export function buildContactContent(contact: ContactData): AnyMessageContent {
  return {
    contacts: {
      contacts: [
        {
          displayName: contact.name,
          vcard: buildVCard(contact),
        },
      ],
    },
  };
}

/**
 * Build multi-contact message content
 */
export function buildMultiContactContent(contacts: ContactData[]): AnyMessageContent {
  return {
    contacts: {
      contacts: contacts.map((contact) => ({
        displayName: contact.name,
        vcard: buildVCard(contact),
      })),
    },
  };
}

/**
 * Send a contact card message
 */
export async function sendContactMessage(
  sock: WASocket,
  jid: string,
  contact: ContactData,
  replyToId?: string,
): Promise<string | undefined> {
  const content = buildContactContent(contact);

  const result = await sock.sendMessage(
    jid,
    content,
    replyToId
      ? {
          quoted: {
            key: { id: replyToId, remoteJid: jid, fromMe: false },
            message: {},
          },
        }
      : undefined,
  );

  return result?.key?.id ?? undefined;
}

/**
 * Send multiple contact cards in one message
 */
export async function sendMultiContactMessage(
  sock: WASocket,
  jid: string,
  contacts: ContactData[],
  replyToId?: string,
): Promise<string | undefined> {
  const content = buildMultiContactContent(contacts);

  const result = await sock.sendMessage(
    jid,
    content,
    replyToId
      ? {
          quoted: {
            key: { id: replyToId, remoteJid: jid, fromMe: false },
            message: {},
          },
        }
      : undefined,
  );

  return result?.key?.id ?? undefined;
}
