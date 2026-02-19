---
description: Send any message type to any Omni channel instance
arguments:
  - name: args
    description: Message options (e.g., --to <recipient> --text "Hello" --instance <id>)
    required: false
---

# /omni:send — Send Message

Send messages via the omni CLI. Supports text, TTS, media, reactions, stickers, embeds, polls, and presence indicators.

## Usage

$ARGUMENTS

## Examples

```bash
omni send --instance my-wa --to 5511999999999@s.whatsapp.net --text "Hello from Omni"
omni send --instance telegram-bot --to 123456789 --tts "Voice message text"
omni send --instance my-wa --to 5511999 --media ./photo.jpg --caption "Check this"
omni send --instance discord-bot --to channel-id --embed --title "Alert" --description "Server OK" --color "#00ff00"
```
