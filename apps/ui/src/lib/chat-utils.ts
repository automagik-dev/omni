import type { Chat } from '@omni/sdk';

/**
 * Format external ID for display when no name is available
 * WhatsApp: 5511999999999@s.whatsapp.net -> +55 11 99999-9999
 * Discord: user#1234 or just ID
 */
export function formatExternalId(externalId: string, _channel?: string): string {
  if (!externalId) return 'Unknown';

  // WhatsApp format: strip @s.whatsapp.net and format phone number
  if (externalId.includes('@s.whatsapp.net') || externalId.includes('@c.us')) {
    const phone = externalId.split('@')[0];
    // Format as phone number if it looks like one
    if (/^\d+$/.test(phone) && phone.length >= 10) {
      // Try to format nicely (country code + area + number)
      if (phone.length === 13 && phone.startsWith('55')) {
        // Brazilian format: +55 11 99999-9999
        return `+${phone.slice(0, 2)} ${phone.slice(2, 4)} ${phone.slice(4, 9)}-${phone.slice(9)}`;
      }
      // Generic format with country code
      return `+${phone.slice(0, 2)} ${phone.slice(2)}`;
    }
    return phone;
  }

  // WhatsApp group format: strip @g.us
  if (externalId.includes('@g.us')) {
    return externalId.split('@')[0];
  }

  // Discord: keep as-is or format
  return externalId;
}

/**
 * Get display name for a chat
 */
export function getChatDisplayName(chat: Chat): string {
  // Use name if available
  if (chat.name) return chat.name;

  // Format the external ID nicely
  return formatExternalId(chat.externalId, chat.channel);
}
