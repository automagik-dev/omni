---
description: Chat browser — list, search, and read conversations as compact JSON. Use when asked what is happening in chats, what is unread, or to pull messages from a conversation.
arguments:
  - name: args
    description: Free-form search query, chat-id, or explicit subcommand (list/messages/archive/participants...)
    required: false
---

# /omni:chats — Chat Browser

Never render table output — rows pad past 1000 chars. Always `--json | jq -r` with a compact selector, and when `$ARGUMENTS` has content, auto-run the best-matching subcommand instead of printing usage.

## Dispatch $ARGUMENTS

- Starts with a subcommand (`list`, `messages`, `archive`, `participants`, `pin`, `mute`, `read`, `label`, ...) — run `omni chats $ARGUMENTS --json`, select only needed fields.
- UUID or JID (`…@s.whatsapp.net` / `…@g.us` / `…@lid`) — chat-id: run the messages template.
- Anything else — search: run the list template. Empty — show the templates and wait.

## Templates (verified)

```bash
# Search / list — flags: --instance, --unread, --attention, --type dm|group|channel, --limit
omni chats list --search "$ARGUMENTS" --json \
  | jq -r '.[] | "\(.id) \(.name // .externalId) | unread:\(.unreadCount // 0) | \((.lastMessagePreview // "") | .[:80])"'

# Messages — for noisy groups add --search "<kw>" or --audio-only / --images-only / --docs-only
omni chats messages "$ARGUMENTS" --since 7d --json \
  | jq -r '.[] | "\(.platformTimestamp[11:16]) \(.senderDisplayName // "?"): \((.textContent // "[media]") | .[:200])"'
```

## Caveats

- Piped `--json` can truncate near 64 KB (issue #402) — on jq "Unfinished string at EOF", write to a file first, then jq the file.
- Unnamed groups: fall back to `.externalId`. LID chats: prefer `.canonicalId`.

Depth: omni-agent skill (chat/message operations) · omni-ops skill § Instances (contacts, groups, sync) · § Batch (backfill missing transcriptions).
