---
description: Full-text message search across all Omni instances. Use to find messages by content — results include audio transcriptions and media descriptions.
arguments:
  - name: args
    description: Search query and filters (e.g., "keyword" --since 7d --type text --chat <id>)
    required: false
---

# /omni:search — Message Search

Use to find messages by content across chats and instances.

## Usage

$ARGUMENTS

## Examples (verified)

```bash
omni messages search "invoice" --since 7d --limit 50
omni messages search "budget" --type audio --since 30d --json
omni messages search "urgent" --chat <chatId> --since 24h
```

Full single-message content: `omni messages get <messageId>`. Chat-scoped browsing: /omni:chats. Event-content search: omni-ops skill § Events.
