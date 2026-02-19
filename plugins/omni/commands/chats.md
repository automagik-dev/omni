---
description: Chat browser — list, filter, archive, and view group metadata
arguments:
  - name: args
    description: Chat subcommand (e.g., list --instance <id> --unread, messages <chat-id>)
    required: false
---

# /omni:chats — Chat Browser

Browse and manage conversations — list, filter, archive, pin, mute, and view participants.

## Usage

$ARGUMENTS

## Examples

```bash
omni chats list --instance my-wa --unread --json | jq '.[] | {name, unreadCount}'
omni chats messages <chat-id> --since 7d --search "keyword"
omni chats archive <chat-id> --instance my-wa
omni chats participants <chat-id> --instance my-wa
```
