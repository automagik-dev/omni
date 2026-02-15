/**
 * Telegram identity utilities
 *
 * Maps Telegram user IDs (numeric) to Omni platform identifiers.
 */

import type { TelegramUser } from '../grammy-shim';

/**
 * Convert Telegram user ID to platform user ID string
 */
export function toPlatformUserId(userId: number): string {
  return String(userId);
}

/**
 * Build display name from Telegram user object
 */
export function buildDisplayName(user: TelegramUser): string {
  const parts: string[] = [];
  if (user.first_name) parts.push(user.first_name);
  if (user.last_name) parts.push(user.last_name);
  return parts.join(' ') || user.username || `User ${user.id}`;
}

/**
 * Get username with @ prefix if available
 */
export function getUsername(user: TelegramUser): string | undefined {
  return user.username ? `@${user.username}` : undefined;
}

/**
 * Check if a chat is a DM (private chat)
 */
export function isPrivateChat(chatType: string): boolean {
  return chatType === 'private';
}

/**
 * Check if a chat is a group chat
 */
export function isGroupChat(chatType: string): boolean {
  return chatType === 'group' || chatType === 'supergroup';
}
