/**
 * WhatsApp as the human ID for login (wish: omni-labs-distribution).
 *
 * The person who owns this Omni is the person who owns one of its connected
 * WhatsApp accounts. Login codes go only to such an account, and only to its
 * own "Message yourself" chat: Omni never sends a code to a number someone
 * typed. A phone number Better Auth asks to send a code to that is not one of
 * these accounts gets nothing.
 */

import { phoneDigits } from '../lib/phone';
import { getPlugin } from '../plugins/loader';
import type { Services } from '../services';
import { selfPlugin } from '../services/whatsapp-self';

/** A WhatsApp account connected to this Omni, by its own number. */
export interface OwnAccount {
  instanceId: string;
  instanceName: string;
  /** Digits of the account's own number, with country code. */
  phone: string;
  /** The JID of its self chat. */
  selfJid: string;
}

/** What login needs of WhatsApp: the connected accounts, and writing in their own self chat. */
export interface WhatsAppAccess {
  accounts(): Promise<OwnAccount[]>;
  /** `operationKey` makes a retry of the same send idempotent. */
  sendToSelf(account: OwnAccount, operationKey: string, text: string): Promise<void>;
}

/** WhatsApp access through the Baileys plugin's self capability. */
export function whatsappAccess(services: Services): WhatsAppAccess {
  const plugin = async () => {
    try {
      return selfPlugin(await getPlugin('whatsapp-baileys'));
    } catch {
      return null;
    }
  };
  return {
    async accounts() {
      const self = await plugin();
      if (!self) return [];
      const { items } = await services.instances.list({ channel: ['whatsapp-baileys'], limit: 100 });
      const accounts: OwnAccount[] = [];
      for (const instance of items) {
        if (!instance.isActive) continue;
        try {
          const identity = self.getSelfIdentity(instance.id);
          const phone = phoneDigits(identity.ownerIdentifier);
          if (phone) {
            accounts.push({ instanceId: instance.id, instanceName: instance.name, phone, selfJid: identity.selfJid });
          }
        } catch {
          // Not connected right now.
        }
      }
      return accounts;
    },
    async sendToSelf(account, operationKey, text) {
      const self = await plugin();
      if (!self) throw new Error('WhatsApp is not available');
      // The identity is read again at send time: the account must still be the one connected.
      const identity = self.getSelfIdentity(account.instanceId);
      if (phoneDigits(identity.ownerIdentifier) !== account.phone) throw new Error('That WhatsApp account changed');
      await self.sendSelf(account.instanceId, {
        expectedOwner: identity.ownerIdentifier,
        expectedGeneration: identity.generation,
        operationKey: operationKey.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 100),
        text,
      });
    },
  };
}

/** The connected account whose own number is `phone` (digits or +E.164), or null. */
export async function accountByPhone(whatsapp: WhatsAppAccess, phone: string): Promise<OwnAccount | null> {
  const digits = phoneDigits(phone);
  if (!digits) return null;
  return (await whatsapp.accounts()).find((account) => account.phone === digits) ?? null;
}

/** "+55 12 •••• 8888": enough for its owner to recognise, not enough to dial. */
export function maskPhone(digits: string): string {
  return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} •••• ${digits.slice(-4)}`;
}
