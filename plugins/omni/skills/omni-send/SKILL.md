---
name: omni-send
description: |
  Send outbound messages with Omni CLI: text, media, TTS, reactions, stickers, contacts, locations, polls, embeds, presence, forwards, and media browsing/download.
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
omni send --to <channel> --poll "Vote?" --options "Yes,No" --multi-select --duration 24 --instance <id> --json
omni send --to <channel> --embed --title "Alert" --description "Details" --color "#00ff00" --url https://x --instance <id> --json

# Presence (with optional recording simulation delay)
omni send --to <recipient> --presence typing --instance <id> --json
omni send --to <recipient> --tts "Hello" --voice-id <voiceId> --presence-delay 3000 --instance <id> --json

# Forward
omni send --to <recipient> --forward --message <messageId> --from-chat <chatId> --instance <id> --json
```

## TTS catalog

```bash
omni tts voices --json
```

## Media browsing

```bash
# List media across an instance (audio, image, video, document)
omni media list --instance <id> --type audio,image --since 2025-01-01 --limit 50 --json
omni media list --chat <chatId> --remote-only --json

# Download a specific media item
omni media download --message <uuid> --output ./file.jpg --json
omni media download --chat <uuid> --external <externalId> --json
```

Flags for `media list`: `--instance <id>`, `--chat <id>`, `--since <datetime>`, `--until <datetime>`, `--type <types>` (audio,image,video,document), `--limit <n>` (default: 20, max: 100), `--remote-only`, `--cached-only`, `--full`

Flags for `media download`: `--message <uuid>`, `--chat <uuid>`, `--external <id>`, `--output <path>`

## Notes

- `--to` accepts phone/JID or Omni UUIDs (chat/person).
- `--presence-delay <ms>` on `omni send --tts` simulates a typing/recording presence before delivering the TTS voice note.
- Add small delays in loops to avoid rate-limit spikes.
