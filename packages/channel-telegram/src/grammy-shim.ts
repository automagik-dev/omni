/**
 * Minimal structural types for Telegram updates used in this package.
 *
 * Why: Bun's TS runtime loader has had crashes when importing `grammy` / `grammy/types`
 * during tests. These shims keep our modules importable in tests without loading grammy.
 *
 * At runtime, actual objects come from grammy; they are structurally compatible.
 */

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  username?: string;
  first_name: string;
  last_name?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
  title?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_size?: number;
}

export interface TelegramFileBase {
  file_id: string;
  mime_type?: string;
  file_name?: string;
}

export interface TelegramSticker {
  file_id: string;
  emoji?: string;
  is_animated?: boolean;
}

export interface TelegramMessageEntity {
  type: string;
  offset: number;
  length: number;
}

export interface TelegramMessageLike {
  message_id: number;
  date: number;
  edit_date?: number;

  chat: TelegramChat;
  from?: TelegramUser;
  sender_chat?: { id: number };

  text?: string;
  caption?: string;
  entities?: TelegramMessageEntity[];

  photo?: TelegramPhotoSize[];
  audio?: TelegramFileBase;
  voice?: TelegramFileBase;
  video?: TelegramFileBase;
  video_note?: TelegramFileBase;
  document?: TelegramFileBase;
  sticker?: TelegramSticker;

  location?: { latitude: number; longitude: number };
  contact?: { first_name: string; phone_number: string };

  reply_to_message?: { message_id: number };
  forward_origin?: unknown;
  message_thread_id?: number;
}

export interface TelegramBotLike {
  botInfo?: { id: number; username?: string; first_name?: string };

  on: (event: string, handler: (ctx: unknown) => unknown | Promise<unknown>) => void;
  catch: (handler: (err: unknown) => unknown | Promise<unknown>) => void;
  init: () => Promise<void>;
  stop: () => void;
  start: (options: Record<string, unknown>) => void;

  token: string;

  api: {
    answerCallbackQuery: (id: string) => Promise<unknown>;
    sendChatAction: (chatId: string, action: string) => Promise<unknown>;

    sendMessage: (chatId: string, text: string, options?: Record<string, unknown>) => Promise<{ message_id: number }>;
    editMessageText: (
      chatId: string,
      messageId: number,
      text: string,
      options?: Record<string, unknown>,
    ) => Promise<unknown>;
    deleteMessage: (chatId: string, messageId: number) => Promise<unknown>;
    setMessageReaction: (
      chatId: string,
      messageId: number,
      reactions: Array<Record<string, unknown>>,
    ) => Promise<unknown>;

    sendPhoto: (chatId: string, photo: string, options?: Record<string, unknown>) => Promise<{ message_id: number }>;
    sendAudio: (chatId: string, audio: string, options?: Record<string, unknown>) => Promise<{ message_id: number }>;
    sendVideo: (chatId: string, video: string, options?: Record<string, unknown>) => Promise<{ message_id: number }>;
    sendSticker: (
      chatId: string,
      sticker: string,
      options?: Record<string, unknown>,
    ) => Promise<{ message_id: number }>;
    sendContact: (
      chatId: string,
      phone: string,
      firstName: string,
      options?: Record<string, unknown>,
    ) => Promise<{ message_id: number }>;
    sendLocation: (
      chatId: string,
      latitude: number,
      longitude: number,
      options?: Record<string, unknown>,
    ) => Promise<{ message_id: number }>;
    sendDocument: (
      chatId: string,
      document: unknown,
      options?: Record<string, unknown>,
    ) => Promise<{ message_id: number }>;

    forwardMessage: (toChatId: string, fromChatId: string, messageId: number) => Promise<{ message_id: number }>;
    getMe: () => Promise<{
      id: number;
      is_bot: boolean;
      first_name: string;
      last_name?: string;
      username?: string;
      can_join_groups?: boolean;
      can_read_all_group_messages?: boolean;
      supports_inline_queries?: boolean;
    }>;
    getUserProfilePhotos: (
      userId: number,
      options?: Record<string, unknown>,
    ) => Promise<{ total_count: number; photos: Array<Array<{ file_id: string }>> }>;
    getFile: (fileId: string) => Promise<{ file_path?: string }>;
    getChat: (chatId: string) => Promise<
      Record<string, unknown> & {
        id: number;
        type: string;
        first_name?: string;
        last_name?: string;
        title?: string;
        username?: string;
        bio?: string;
        photo?: { big_file_id: string };
      }
    >;
  };
}
