# Omni Message Types

| Type | Flag | Required Args | Example |
|------|------|---------------|---------|
| Text | `--text` | `--to`, `--instance` | `omni send --to +5511999 --text "Hello" --instance wa` |
| TTS | `--tts` | `--to`, `--instance` | `omni send --to +5511999 --tts "Voice note" --instance wa` |
| TTS (custom voice) | `--tts`, `--voice-id` | `--to`, `--instance` | `omni send --to +5511999 --tts "Hi" --voice-id xWdp --instance wa` |
| Image | `--media` | `--to`, `--instance`, file path | `omni send --to +5511999 --media ./photo.jpg --instance wa` |
| Image + Caption | `--media`, `--caption` | `--to`, `--instance`, file path | `omni send --to +5511999 --media ./photo.jpg --caption "Look" --instance wa` |
| Audio | `--media`, `--voice` | `--to`, `--instance`, file path | `omni send --to +5511999 --media ./audio.mp3 --voice --instance wa` |
| Video | `--media` | `--to`, `--instance`, file path | `omni send --to +5511999 --media ./video.mp4 --instance wa` |
| Document | `--media` | `--to`, `--instance`, file path | `omni send --to +5511999 --media ./report.pdf --instance wa` |
| Reaction | `--reaction` | `--to`, `--message`, `--instance` | `omni send --to +5511999 --reaction "👍" --message msg_abc --instance wa` |
| Sticker | `--sticker` | `--to`, `--instance`, URL | `omni send --to +5511999 --sticker https://ex.com/s.webp --instance wa` |
| Contact | `--contact` | `--to`, `--name`, `--phone`, `--instance` | `omni send --to +5511999 --contact --name "A" --phone +55 --instance wa` |
| Location | `--location` | `--to`, `--lat`, `--lng`, `--instance` | `omni send --to +5511999 --location --lat -23 --lng -46 --instance wa` |
| Poll | `--poll` | `--to`, `--options`, `--instance` | `omni send --to ch-id --poll "Q?" --options "A,B" --instance dc` |
| Embed | `--embed` | `--to`, `--title`, `--instance` | `omni send --to ch-id --embed --title "T" --description "D" --instance dc` |
| Presence | `--presence` | `--to`, `--instance` | `omni send --to +5511999 --presence typing --instance wa` |

## Notes

- `--json` works with every send command for structured output
- Response wrapper: `{ "success": true, "data": { "messageId": "..." } }`
- Extract ID: `omni send ... --json | jq -r '.data.messageId'`
