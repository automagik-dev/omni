---
name: omni-send
description: |
  Send messages via the omni CLI — covers text, TTS, media, reactions, stickers, embeds, polls, and forwarding across all Omni channel instances.
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Send

Send any message type to any Omni channel instance using `omni send`.

## Text Messages

```bash
omni send --to <recipient> --text "Hello!" --instance <id>
omni send --to <recipient> --text "Reply" --reply-to <msg-id> --instance <id>
```

## TTS Voice Notes

```bash
omni send --to <recipient> --tts "Hello, this is synthesized speech!" --instance <id>
omni send --to <recipient> --tts "Custom voice" --voice-id <voice-id> --instance <id>
```

## Media Messages

```bash
omni send --to <recipient> --media ./photo.jpg --caption "Check this out" --instance <id>
omni send --to <recipient> --media ./audio.mp3 --voice --instance <id>
omni send --to <recipient> --media ./video.mp4 --instance <id>
omni send --to <recipient> --media ./report.pdf --instance <id>
```

## Reactions

```bash
omni send --to <recipient> --reaction "👍" --message <msg-id> --instance <id>
```

## Stickers

```bash
omni send --to <recipient> --sticker https://example.com/sticker.webp --instance <id>
```

## Contact Cards

```bash
omni send --to <recipient> --contact --name "Name" --phone +5511999 --email a@b.com --instance <id>
```

## Location

```bash
omni send --to <recipient> --location --lat -23.5505 --lng -46.6333 --address "São Paulo" --instance <id>
```

## Polls (Discord)

```bash
omni send --to <channel-id> --poll "Question?" --options "A,B,C" --multi-select --duration 24 --instance <id>
```

## Embeds (Discord)

```bash
omni send --to <channel-id> --embed --title "Alert" --description "Details" --color "#00ff00" --instance <id>
```

## Presence Indicators

```bash
omni send --to <recipient> --presence typing --instance <id>
omni send --to <recipient> --presence recording --instance <id>
omni send --to <recipient> --presence paused --instance <id>
```

## Tips

- Use `--json` on any send command to get structured output with `messageId`.
- Extract message IDs: `omni send --to ... --text "Hi" --json | jq -r '.data.messageId'`
- Rate limit loops: `sleep 1` between sends in batch scripts.
