---
name: omni-chats
description: |
  Manage Omni conversations: list/get/create/update, archive/pin/mute, participants, disappearing messages, read state, and message history.
allowed-tools: Bash(omni *), Bash(jq *)
---

## Auto-execute

When this skill is invoked **with arguments** (e.g., `/omni:chats nmstx leadership`), skip the reference and auto-execute a search:

```bash
omni chats list --search "<args>" --json | jq -r '.[] | "\(.id) \(.name) | unread: \(.unreadCount) | last: \(.lastMessagePreview[:80])"'
```

Replace `<args>` with the user-supplied arguments verbatim.

When invoked **without arguments**, show the full usage reference below.

### Viewing messages (compact format)

When the user asks to see messages from a chat, use this compact jq format:

```bash
omni chats messages <id> --json | jq -r '.[] | "\(.timestamp[11:16]) \(.senderDisplayName): \(.textContent[:120])"'
```

### Default output

Always prefer `--json | jq` over table format:

- **Table output** has excessive whitespace padding that wastes tokens.
- **Raw `--json`** can be very large; jq field selection keeps output compact.
- **`--json | jq`** with field selection is the best balance of readability and token efficiency for agent consumption.

---

# Omni Chats

## List and inspect

```bash
omni chats list --instance <id> --limit 50 --json
omni chats list --instance <id> --unread --sort activity --verbose --json
omni chats list --channel whatsapp-baileys --type group --json
omni chats list --instance <id> --all --json
omni chats get <chatId> --json
```

## Create and update

```bash
omni chats create --instance <id> --external-id "whatsapp:+5511999" --channel whatsapp-baileys --type private --name "Lead" --json
omni chats create --instance <id> --external-id "..." --channel whatsapp-baileys --type group --name "Team" --description "Team chat" --json
omni chats update <chatId> --name "New name" --description "Notes" --json
omni chats delete <chatId> --json
```

## Chat state actions

```bash
omni chats read <chatId> --instance <id> --json
omni chats archive <chatId> --instance <id> --json
omni chats unarchive <chatId> --instance <id> --json
omni chats pin <chatId> --instance <id> --json
omni chats unpin <chatId> --instance <id> --json
omni chats mute <chatId> --instance <id> --duration 28800000 --json
omni chats unmute <chatId> --instance <id> --json
omni chats disappearing <chatId> --instance <id> --duration 24h --json
```

## Messages in a chat

```bash
omni chats messages <chatId> --limit 100 --json
omni chats messages <chatId> --since 7d --search "invoice" --json
omni chats messages <chatId> --audio-only --compact --truncate 120 --json
omni chats messages <chatId> --images-only --before <cursor> --json
omni chats messages <chatId> --videos-only --json
omni chats messages <chatId> --docs-only --json
omni chats messages <chatId> --after <cursor> --json
```

## Participants

```bash
omni chats participants <chatId> --json
omni chats participants <chatId> --add <userId> --name "Member" --role member --json
omni chats participants <chatId> --promote <userId> --json
omni chats participants <chatId> --demote <userId> --json
omni chats participants <chatId> --remove <userId> --json
```
