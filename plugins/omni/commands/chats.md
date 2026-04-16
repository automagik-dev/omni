---
description: Chat browser — list, filter, archive, and view messages (compact JSON + jq by default)
arguments:
  - name: args
    description: Free-form search query, chat-id, or explicit subcommand (list/messages/archive/participants...)
    required: false
---

# /omni:chats — Chat Browser

Browse and manage conversations — list, filter, archive, pin, mute, and view participants.

**Defaults you must honor as an agent:**

- **Never use table output.** Table rows pad to ~1000+ chars and blow the token budget.
- **Always use `--json | jq -r`** with a compact selector. Select only the fields needed.
- **Auto-execute** — when `$ARGUMENTS` contains content, run the best-matching subcommand directly instead of printing usage.

---

## How to dispatch `$ARGUMENTS`

| Input shape | What to run |
|-------------|-------------|
| Empty | Print the one-liners below and wait for user input. |
| Starts with `list`/`messages`/`archive`/`participants`/`create`/`update`/`delete`/`pin`/`mute`/`read`/`label`/`hide`/`disappearing` | Treat as explicit subcommand: run `omni chats $ARGUMENTS --json` and pipe through a `jq` selector that matches that subcommand. |
| UUID (36 chars with dashes) or JID (`…@s.whatsapp.net` / `…@g.us` / `…@lid`) | Treat as a chat-id and run the `messages` template below. |
| Anything else | Treat as a `list --search` query: run the search template below. |

---

## Templates (copy these verbatim, substitute `$ARGUMENTS`)

### Search / list (default for free-form text)

```bash
omni chats list --search "$ARGUMENTS" --json \
  | jq -r '.[] | "\(.id) \(.name // .externalId) | unread:\(.unreadCount // 0) | \((.lastMessagePreview // "") | .[:80])"'
```

Useful flag additions:

- `--instance <id>` — scope to one channel instance
- `--unread` — only chats with unread messages
- `--attention` — unread + pending + follow-up
- `--type dm|group|channel` — filter chat type
- `--limit <n>` — cap result count

### Messages (when `$ARGUMENTS` is a chat-id)

```bash
omni chats messages "$ARGUMENTS" --since 7d --json \
  | jq -r '.[] | "\(.timestamp[11:16]) \(.senderDisplayName // "?"): \((.textContent // "[media]") | .[:200])"'
```

For noisy group chats, add `--search "<keyword>"` or `--audio-only` / `--images-only` / `--docs-only`.

### Archive / participants / read / pin / mute

Pass `$ARGUMENTS` through and pipe JSON when the subcommand returns structured data:

```bash
omni chats participants <chat-id> --instance <inst> --json \
  | jq -r '.[] | "\(.platformUserId) \(.displayName // "-") [\(.role // "member")]"'
```

Mutations (`archive`, `delete`, `read`, `pin`, `mute`, `label`) typically return a terse status — run them with `--json` and log the result line.

---

## Output-shape cheat sheet

`chats list` JSON items expose: `id`, `name`, `externalId`, `unreadCount`, `lastMessageAt`, `lastMessagePreview`, `messageCount`, `isGroup`, `instanceId`, `channelType`, `canonicalId`.

`chats messages` JSON items expose: `id`, `timestamp`, `textContent`, `senderDisplayName`, `senderPlatformUserId`, `hasMedia`, `mediaMimeType`, `transcription`, `imageDescription`, `videoDescription`, `documentExtraction`, `isFromMe`.

Select only what you need; skip the rest.

---

## Known caveats

- **Large message streams**: `omni chats messages` JSON output has been observed to truncate at ~64 KB when piped (see issue #402). If your `jq` errors with "Unfinished string at EOF", redirect to a file first: `omni … --json > /tmp/out.json && jq … /tmp/out.json`.
- **Groups without names**: fall back to `.externalId` (ends in `@g.us`).
- **LID JIDs**: use `.canonicalId` when present — it resolves the phone JID for anonymized linked-identity chats.
