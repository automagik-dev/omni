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
omni media download --chat <chatId> --external <externalId> --json
```

Flags for `media list`: `--instance <id>`, `--chat <chatId>`, `--since <datetime>`, `--until <datetime>`, `--type <types>` (audio,image,video,document), `--limit <n>` (default: 20, max: 100), `--remote-only`, `--cached-only`, `--full`

Flags for `media download`: `--message <uuid>`, `--chat <chatId>`, `--external <externalId>`, `--output <path>`

## Recipient resolution (`--to`)

The `--to` flag supports multiple identifier formats with smart resolution:

```bash
# Phone number — passed through directly
omni send --to +5511999887766 --text "Hi" --instance <id> --json

# WhatsApp JID — passed through directly
omni send --to 5511999887766@s.whatsapp.net --text "Hi" --instance <id> --json

# Full Omni UUID (chat or person)
omni send --to 550e8400-e29b-41d4-a716-446655440000 --text "Hi" --instance <id> --json

# Short ID prefix — resolves to full UUID (same as omni chats messages)
omni send --to c14b05ff --text "Hi" --instance <id> --json

# Chat name — resolves by exact or substring match (case-insensitive)
omni send --to "Felipe" --text "Hi" --instance <id> --json
```

Short ID resolution: any hex string (2+ chars) that isn't a phone number is treated as a UUID prefix. The CLI fetches the chat list and matches the prefix. If ambiguous (multiple matches), it prints the candidates and exits with an error.

## @name mention auto-resolution (WhatsApp)

When sending text to WhatsApp, `@name` patterns in the message body are automatically resolved to WhatsApp JID mentions. The resolver matches contact names from the instance's contact list.

```bash
# @Felipe is resolved to the contact's JID and rendered as a clickable mention
omni send --to <group-jid> --text "Hey @Felipe, check this out" --instance <id> --json

# Multiple mentions
omni send --to <group-jid> --text "@Ana and @Carlos please review" --instance <id> --json
```

Resolution rules:
- Exact match first (case-insensitive): `@felipe` matches contact named "Felipe"
- Prefix match fallback: `@Fel` matches "Felipe" if no exact match exists
- Unresolved names are left as literal text (no error)
- Only works on WhatsApp instances — other channels ignore `@name` syntax

## Notes

- `--to` accepts phone/JID, Omni UUIDs (chat/person), short ID prefixes, or chat names.
- `--presence-delay <ms>` on `omni send --tts` simulates a typing/recording presence before delivering the TTS voice note.
- Add small delays in loops to avoid rate-limit spikes.
