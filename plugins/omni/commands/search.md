---
description: Full-text message search with filters across all Omni instances
arguments:
  - name: args
    description: Search query and filters (e.g., "keyword" --since 7d --type text --chat <id>)
    required: false
---

# /omni:search — Message Search

Search messages across all Omni channel instances with full-text search and filters.

## Usage

$ARGUMENTS

## Examples

```bash
omni messages search "invoice" --since 7d --limit 50
omni messages search "" --type audio --since 30d --json | jq '.[] | {sender: .senderDisplayName, transcription}'
omni messages search "urgent" --chat <chat-id> --since 24h
```
