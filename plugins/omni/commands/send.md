---
description: Send any message type out-of-turn to any Omni channel instance — text, media, TTS, polls, embeds. Inside a turn, use the verbs (omni say / done) instead.
arguments:
  - name: args
    description: Message options (e.g., --to <recipient> --text "Hello" --instance <id>)
    required: false
---

# /omni:send — Out-of-Turn Send

Use for proactive delivery (crons, alerts, cross-chat). Inside an Omni turn (`OMNI_INSTANCE` set) use `omni say` / `omni done` — never `send`.

## Usage

$ARGUMENTS

## Examples (verified)

```bash
omni send --instance <id> --to +5511999999999 --text "Hello"
omni send --instance <id> --to <jid-or-uuid> --media ./photo.jpg --caption "Check this"
omni send --instance <id> --to <chatId> --tts "Voice message" --voice-id <elevenlabs-id>
```

`--to` accepts a WA JID, phone (+55…), or Omni chat/person UUID. Polls, embeds, stickers, forwards, presence: omni-agent skill (send edge cases).
