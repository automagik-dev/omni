# Omni CLI Cheatsheet

## Send

```bash
# Text
omni send --to <recipient> --text "Hello" --instance <id>

# TTS voice note
omni send --to <recipient> --tts "Voice text" --instance <id>

# Media (image, audio, video, document)
omni send --to <recipient> --media ./file.jpg --caption "Cap" --instance <id>

# Reaction
omni send --to <recipient> --reaction "👍" --message <msg-id> --instance <id>

# Sticker
omni send --to <recipient> --sticker <url> --instance <id>

# Reply
omni send --to <recipient> --text "Reply" --reply-to <msg-id> --instance <id>

# Contact card
omni send --to <recipient> --contact --name "Name" --phone +5511999 --instance <id>

# Location
omni send --to <recipient> --location --lat -23.55 --lng -46.63 --instance <id>

# Presence
omni send --to <recipient> --presence typing --instance <id>
```

## Search

```bash
# Full-text search
omni messages search "keyword" --since 7d

# Filter by type
omni messages search "" --type audio --since 30d

# Filter by chat
omni messages search "invoice" --chat <chat-id>

# Limit results
omni messages search "urgent" --limit 50 --json
```

## Batch

```bash
# Create transcription job
omni batch create --instance <id> --type transcribe --days 30

# Create text extraction job
omni batch create --instance <id> --type extract-text --content-types audio,image

# Estimate cost
omni batch estimate --instance <id> --type transcribe --days 7

# Monitor job
omni batch status <job-id> --watch

# Cancel job
omni batch cancel <job-id>
```

## Output & Piping

```bash
# JSON output (any command)
omni <command> --json

# Extract message ID from send
omni send --to <phone> --text "Hi" --json | jq -r '.data.messageId'

# Filter connected instances
omni instances list --json | jq '.[] | select(.status=="connected")'

# Count unread chats
omni chats list --instance <id> --unread --json | jq length

# Export chat history
omni chats messages <chat-id> --limit 1000 --json > export.json
```
