/**
 * Contact (vCard) message sender
 */

import type { AnyMessageContent, WASocket } from '@whiskeysockets/baileys';

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
 * Build a vCard string from contact data
 */
export function buildVCard(contact: ContactData): string {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${contact.name}`, `N:;${contact.name};;;`];

  if (contact.phone) {
    // Clean phone number
    const phone = contact.phone.replace(/[^\d+]/g, '');
    lines.push(`TEL;type=CELL;type=VOICE;waid=${phone.replace(/^\+/, '')}:${phone}`);
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
    replyToId ? { quoted: { key: { id: replyToId, remoteJid: jid } } as never } : undefined,
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
    replyToId ? { quoted: { key: { id: replyToId, remoteJid: jid } } as never } : undefined,
  );

  return result?.key?.id ?? undefined;
}
