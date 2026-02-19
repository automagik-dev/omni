---
description: TTS voice selector and send voice note
arguments:
  - name: args
    description: TTS options (e.g., voices, or --to <recipient> --tts "text" --voice-id <id>)
    required: false
---

# /omni:tts — Text-to-Speech

List available TTS voices and send synthesized voice notes.

## Usage

$ARGUMENTS

## Examples

```bash
omni tts voices
omni tts voices --json | jq '.[] | {voiceId, name, category}'
omni send --to 5511999 --tts "Hello, this is a voice note!" --instance my-wa
omni send --to 5511999 --tts "[excited] Great news!" --voice-id xWdpADtEio43ew1zGxUQ --instance my-wa
```
