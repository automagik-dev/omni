---
name: omni-send
description: |
  Send outbound messages with Omni CLI: text, media, TTS, reactions, stickers, contacts, locations, polls, embeds, presence, and forwards.
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Send

Use `omni send` for delivery actions, and `omni tts voices` to inspect available TTS voices.

## Core patterns

```bash
# Prefer JSON for agents
omni send --to <recipient> --text "Hello" --instance <id> --json

# Extract ID for follow-up actions
omni send --to <recipient> --text "Hello" --instance <id> --json | jq -r '.data.messageId'
```

## Send types (`omni send`)

```bash
# Text / reply
omni send --to <recipient> --text "Hi" --instance <id> --json
omni send --to <recipient> --text "Reply" --reply-to <messageId> --instance <id> --json

# Media / voice note from audio file
omni send --to <recipient> --media ./file.jpg --caption "See" --instance <id> --json
omni send --to <recipient> --media ./audio.mp3 --voice --instance <id> --json

# TTS voice note (inline)
omni send --to <recipient> --tts "Olá" --voice-id <voiceId> --instance <id> --json

# Reactions / stickers
omni send --to <recipient> --reaction "👍" --message <messageId> --instance <id> --json
omni send --to <recipient> --sticker <url-or-base64> --instance <id> --json

# Contact / location
omni send --to <recipient> --contact --name "Name" --phone +5511999 --email a@b.com --instance <id> --json
omni send --to <recipient> --location --lat -23.55 --lng -46.63 --address "São Paulo" --instance <id> --json

# Discord poll / embed
omni send --to <channel> --poll "Lunch?" --options "Pizza,Sushi" --duration 24 --instance <id> --json
omni send --to <channel> --embed --title "Alert" --description "Details" --color "#00ff00" --url https://x --instance <id> --json

# Presence + forward
omni send --to <recipient> --presence typing --instance <id> --json
omni send --to <recipient> --forward --message <messageId> --from-chat <chatId> --instance <id> --json
```

## TTS catalog

```bash
omni tts voices --json
```

## Notes

- `--to` accepts phone/JID or Omni UUIDs (chat/person).
- Add small delays in loops to avoid rate-limit spikes.
