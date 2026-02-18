---
name: omni-messages
description: |
  Search, retrieve, edit, delete, star, and manage message reactions across all Omni channel instances via the omni CLI.
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Messages

Search and manage messages across all Omni channel instances using `omni messages`.

## Search Messages

```bash
omni messages search "keyword" --since 7d
omni messages search "urgent" --since 7d --json | jq '.[] | {id, content, from: .sender.displayName}'
```

### Search Filters

| Filter | Description | Example |
|--------|-------------|---------|
| `--content` | Full-text content search | `--content "invoice"` |
| `--type` | Message type filter | `--type text`, `--type audio` |
| `--chat` | Filter by chat ID | `--chat <chat-id>` |
| `--since` | Time range start | `--since 7d`, `--since 24h` |
| `--limit` | Max results | `--limit 50` |

```bash
omni messages search "" --type audio --since 30d --limit 100 --json
omni messages search "report" --chat <chat-id> --since 1w
```

## Get Message

```bash
omni messages get <message-id>
omni messages get <message-id> --json
```

## Edit Message

```bash
omni messages edit <message-id> --text "Updated text" --instance <id>
```

## Delete Message

```bash
omni messages delete <message-id> --instance <id>
```

## Star / Unstar

```bash
omni messages star <message-id> --instance <id>
omni messages unstar <message-id> --instance <id>
```

## Mark as Read

```bash
omni messages mark-read <message-id> --instance <id>
omni messages read --batch --instance <id> --ids id1,id2,id3
```

## Reactions

```bash
omni send --to <recipient> --reaction "👍" --message <msg-id> --instance <id>
```

## JSON Field Mappings

When using `--json`, key fields are:

- `senderDisplayName` — sender name
- `messageType` — text, audio, image, video, sticker, reaction
- `textContent` — text body (null for non-text)
- `transcription` — audio transcription (if processed)
- `mediaUrl` — media file URL
- `platformTimestamp` — message timestamp

```bash
omni chats messages <chat-id> --json | jq '.[] | {sender: .senderDisplayName, type: .messageType, text: .textContent}'
```
