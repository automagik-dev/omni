---
name: omni-chats
description: |
  Browse and manage Omni chats — list conversations with filters, archive, view participants, access group metadata, and browse message history.
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Chats

Manage conversations across all Omni channel instances using `omni chats`.

## List Chats

```bash
omni chats list --instance <id>
omni chats list --instance <id> --unread
omni chats list --instance <id> --sort activity --verbose
omni chats list --instance <id> --json | jq '.[] | {id, name, unreadCount}'
```

## Chat Details

```bash
omni chats get <chat-id> --instance <id>
```

## Create Chat

```bash
omni chats create --instance <id> --external-id "whatsapp:+5511999" --channel whatsapp
```

## Browse Messages

```bash
omni chats messages <chat-id> --limit 50
omni chats messages <chat-id> --search "invoice" --limit 100
omni chats messages <chat-id> --since 7d
omni chats messages <chat-id> --audio-only
omni chats messages <chat-id> --images-only
omni chats messages <chat-id> --compact --truncate 100
```

## Mark as Read

```bash
omni chats read <chat-id> --instance <id>
```

## Archive / Unarchive

```bash
omni chats archive <chat-id> --instance <id>
omni chats unarchive <chat-id> --instance <id>
```

## Pin / Unpin

```bash
omni chats pin <chat-id> --instance <id>
omni chats unpin <chat-id> --instance <id>
```

## Mute / Unmute

```bash
omni chats mute <chat-id> --instance <id>
omni chats unmute <chat-id> --instance <id>
```

## Disappearing Messages

```bash
omni chats disappearing <chat-id> --instance <id> --duration 24h
omni chats disappearing <chat-id> --instance <id> --duration off
```

## Delete

```bash
omni chats delete <chat-id> --instance <id>
```

## Participants

```bash
omni chats participants <chat-id> --instance <id>
```
