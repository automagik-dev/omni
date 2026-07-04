---
description: TTS voice selector and voice-note sender. Use to list available voices or send synthesized speech to a chat.
arguments:
  - name: args
    description: TTS options (e.g., voices, or --to <recipient> --tts "text" --voice-id <id>)
    required: false
---

# /omni:tts — Voice Notes

Use to pick a TTS voice or send text as a synthesized voice note.

## Usage

$ARGUMENTS

## Examples (verified)

```bash
omni tts voices --json
omni send --instance <id> --to +5511999 --tts "Hello!" --voice-id <elevenlabs-id>
omni speak "On my way" --voice Kore   # inside a turn — chat context pre-set
```

Providers (gemini/openai/elevenlabs), style prompts, language: omni-agent skill (speak verb) and `omni speak --help`.
