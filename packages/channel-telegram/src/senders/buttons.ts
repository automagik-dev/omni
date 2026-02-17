/**
 * Inline button sender for Telegram (InlineKeyboard)
 *
 * Supports:
 * - Scope filtering: off/dm/group/all (default: all) — controls visibility by chat type
 * - Style hints: default/primary/danger/success — emoji prefix visual cues
 */

import { createLogger } from '@omni/core';
import type { TelegramBotLike } from '../grammy-shim';
import { markdownToTelegramHtml } from '../utils/markdown-to-html';
import { sendTextMessage } from './text';

const log = createLogger('telegram:sender:buttons');

export type ButtonScope = 'off' | 'dm' | 'group' | 'all';
export type ButtonStyle = 'default' | 'primary' | 'danger' | 'success';

export type TelegramInlineButton = {
  text: string;
  data?: string;
  url?: string;
  /** Visibility scope: 'off' = never, 'dm' = DM only, 'group' = group only, 'all' = everywhere (default) */
  scope?: ButtonScope;
  /** Visual style hint via emoji prefix */
  style?: ButtonStyle;
};

/** Style-to-emoji prefix mapping */
const STYLE_PREFIXES: Record<ButtonStyle, string> = {
  default: '',
  primary: '\u{1F535} ', // 🔵
  danger: '\u{1F534} ', // 🔴
  success: '\u{1F7E2} ', // 🟢
};

/**
 * Filter buttons based on chat type and scope.
 * - scope 'all' (or undefined): always shown
 * - scope 'dm': only shown in DM (private) chats
 * - scope 'group': only shown in group/supergroup chats
 * - scope 'off': never shown
 */
export function filterButtonsByScope(
  buttons: TelegramInlineButton[],
  chatType: 'dm' | 'group' | 'channel' | 'private' | 'supergroup' | undefined,
): TelegramInlineButton[] {
  const isDM = chatType === 'dm' || chatType === 'private';
  const isGroup = chatType === 'group' || chatType === 'supergroup';

  return buttons.filter((b) => {
    const scope = b.scope ?? 'all';
    if (scope === 'off') return false;
    if (scope === 'all') return true;
    if (scope === 'dm') return isDM;
    if (scope === 'group') return isGroup;
    return true;
  });
}

/**
 * Apply style prefixes to button labels.
 */
function applyStyles(buttons: TelegramInlineButton[]): TelegramInlineButton[] {
  return buttons.map((b) => {
    const style = b.style ?? 'default';
    const prefix = STYLE_PREFIXES[style] ?? '';
    if (!prefix) return b;
    return { ...b, text: `${prefix}${b.text}` };
  });
}

function buildInlineKeyboard(buttons: TelegramInlineButton[]) {
  // Apply style prefixes before building keyboard
  const styled = applyStyles(buttons);

  const row = styled
    .map((b) => {
      if (b.url) return { text: b.text, url: b.url };
      return { text: b.text, callback_data: b.data ?? b.text };
    })
    .filter((b) => typeof b.text === 'string' && (typeof (b as { url?: string }).url === 'string' || true));

  return { inline_keyboard: [row] };
}

/**
 * Sends a message with inline buttons.
 *
 * Telegram requires a text for `sendMessage` when attaching an inline keyboard.
 * Buttons are filtered by scope based on chatType before sending.
 */
export async function sendInlineButtons(
  bot: TelegramBotLike,
  chatId: string,
  text: string,
  buttons: TelegramInlineButton[],
  replyToMessageId?: number,
  formatMode: 'convert' | 'passthrough' = 'convert',
  options?: Record<string, unknown>,
): Promise<number> {
  // Determine chat type from options (passed by plugin.ts via threadOptions or metadata)
  const chatType = options?.chatType as string | undefined;

  // Filter buttons by scope
  const visibleButtons = filterButtonsByScope(buttons, chatType as TelegramInlineButton['scope']);

  // If no buttons remain after filtering, send as plain text
  if (!visibleButtons.length) {
    return sendTextMessage(bot, chatId, text, replyToMessageId, formatMode, options);
  }

  const useConversion = formatMode !== 'passthrough';
  const payloadText = useConversion ? markdownToTelegramHtml(text || ' ') : text || ' ';

  const result = await bot.api.sendMessage(chatId, payloadText, {
    ...(formatMode !== 'passthrough' ? { parse_mode: 'HTML' as const } : {}),
    ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
    reply_markup: buildInlineKeyboard(visibleButtons),
    ...(options ?? {}),
  });

  log.debug('Sent inline buttons', {
    chatId,
    messageId: result.message_id,
    total: buttons.length,
    visible: visibleButtons.length,
  });
  return result.message_id;
}
