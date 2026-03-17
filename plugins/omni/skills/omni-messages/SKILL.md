---
name: omni-messages
description: |
  Search and manage messages with Omni CLI: get details, read receipts, edit/delete, star/unstar, and reaction removal.
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Messages

Use `omni messages` for direct message operations and `omni chats messages` for chat history browsing.

## Search and inspect

```bash
# Search across chats
omni messages search "invoice" --since 7d --limit 50 --json
omni messages search "" --type audio --since 30d --json
omni messages search "urgent" --chat <chatId> --since 24h --json

# Full message details (includes transcription/description fields)
omni messages get <messageId> --json
```

## Read receipts

```bash
# Single
omni messages read <messageId> --instance <id> --json

# Batch in a chat
omni messages read --batch --chat <chatId> --ids id1,id2,id3 --instance <id> --json
```

## Mutations

```bash
# Edit / delete
omni messages edit <messageId> --chat <chatJid> --text "Updated" --instance <id> --json
omni messages delete <messageId> --chat <chatJid> --instance <id> --json

# Star / unstar
omni messages star <messageId> --chat <chatJid> --instance <id> --json
omni messages unstar <messageId> --chat <chatJid> --instance <id> --json

# Remove a reaction
omni messages remove-reaction <messageId> --emoji "👍" --instance <id> --json
```

## Chat history (`omni chats messages`)

```bash
omni chats messages <chatId> --limit 100 --json
omni chats messages <chatId> --since 7d --audio-only --json
omni chats messages <chatId> --media-only --search "receipt" --compact --json
```

## Notes

- `--type` in search currently supports: `text,image,audio,document`.
- For edits/deletes/stars, WhatsApp flows commonly require `--chat <chatJid>`.
- Messages from **hidden chats** are excluded from listings by default. Use `includeHidden=true` query param to include them.
