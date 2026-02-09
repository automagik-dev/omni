# @omni/channel-telegram

> Telegram channel plugin for Omni v2 using grammy

## Overview

Telegram Bot API integration via [grammy](https://grammy.dev/). Supports both webhook and long-polling modes.

## Key Patterns

- **Plugin class**: `TelegramPlugin` extends `BaseChannelPlugin` from `@omni/channel-sdk`
- **Bot framework**: grammy (lightweight, TypeScript-native, Bun-compatible)
- **Connection modes**: Webhook (production) or long-polling (development)
- **Reactions**: Bot API 7.3+ `message_reaction` update type

## Instance Config

```json
{
  "token": "BOT_TOKEN",
  "mode": "polling" | "webhook",
  "webhookUrl": "https://...",
  "webhookSecret": "optional_secret",
  "allowedUpdates": ["message", "message_reaction", "callback_query"]
}
```

## Telegram-specific Notes

- User IDs are numeric (stored as strings: `String(user.id)`)
- Chat types: `private` (DM), `group`, `supergroup`, `channel`
- Bot API rate limits: ~30 messages/second globally, 1 msg/s per chat in groups
- Reactions require the bot to be an admin in groups (for `message_reaction` updates)
- Stickers are a first-class type in Telegram (not media files)
- Max message length: 4096 characters
