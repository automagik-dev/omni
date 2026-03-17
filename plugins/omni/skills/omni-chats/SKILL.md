---
name: omni-chats
description: |
  Manage Omni conversations: list/get/create/update, archive/pin/mute, hide/unhide, label/unlabel, attention/pending filters, participants, disappearing messages, read state, and message history.
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Chats

## List and inspect

```bash
omni chats list --instance <id> --limit 50 --json
omni chats list --instance <id> --unread --sort activity --verbose --json
omni chats list --channel whatsapp-baileys --type group --json
omni chats list --instance <id> --search "client name" --json
omni chats list --instance <id> --all --json
omni chats get <chatId> --json
```

### List flags reference

| Flag | Description |
|------|-------------|
| `--instance <id>` | Filter by instance ID |
| `--channel <type>` | Filter by channel type (whatsapp-baileys, discord, etc.) |
| `--search <query>` | Search chats by name |
| `--type <type>` | Filter by chat type: `dm`, `group`, `channel`. When omitted, all types are shown (no filtering). |
| `--limit <n>` | Limit number of results |
| `--sort <field>` | Sort by: `activity` (default), `unread`, `name` |
| `--unread` | Only show chats with unread messages |
| `--archived` | Include archived chats |
| `--all` | Include newsletters and broadcasts |
| `--verbose` | Show full details (ID, channel, archived status) |
| `--pending` | Only show chats pending a reply (last message is not from me AND has unreads) |
| `--attention` | Show chats needing attention (combines: unread + pending reply + follow-up labeled) |
| `--label <name>` | Filter chats by label (e.g., `follow-up`, `todo`, `vip`) |
| `--hidden` | Include hidden chats in the listing (hidden chats are excluded by default) |

### Pagination

The `list` command displays pagination metadata after the table:

```
ℹ Showing 3 of 3 chats
```

When `--limit` truncates results, this shows how many were returned vs. total matching.

## Attention and pending

```bash
# Chats needing attention (unread + pending reply + follow-up labeled)
omni chats list --instance <id> --attention --json

# Only chats where last message is not from me AND has unreads
omni chats list --instance <id> --pending --json

# Filter by label
omni chats list --instance <id> --label follow-up --json
omni chats list --instance <id> --label todo --json

# Include hidden chats in listing
omni chats list --instance <id> --hidden --json
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

## Visibility (privacy)

```bash
# Hide chat from agent view (agent won't see it in listings or know it exists)
omni chats hide <chatId> --json

# Unhide chat
omni chats unhide <chatId> --json
```

## Labels

```bash
# Add a label to a chat
omni chats label <chatId> follow-up --json
omni chats label <chatId> todo --json
omni chats label <chatId> vip --json

# Remove a label
omni chats unlabel <chatId> follow-up --json
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
