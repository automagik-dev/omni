# Message browsing and voice selection

Discover installed filters with `omni chats --help`, `omni chats messages --help` and `omni messages search --help`. Search across messages (including transcriptions/descriptions), read a message by ID, or browse a chosen chat. Keep results within the credential's access; an empty result is not permission to broaden grants.

For compact chat results, use JSON and select only needed fields instead of padded tables. Resolve the user's query as a search, a chat UUID/JID as message history, or explicit operations through the corresponding help. With no target or query, clarify it before acting.

```bash
omni chats list --search "<query>" --json \
  | jq -r '.[] | "\(.id) \(.name // .externalId) | unread:\(.unreadCount // 0) | \((.lastMessagePreview // "") | .[:80])"'
omni chats messages <chatId> --since 7d --json \
  | jq -r '.[] | "\(.platformTimestamp[11:16]) \(.senderDisplayName // "?"): \((.textContent // "[media]") | .[:200])"'
```

For unnamed groups use `externalId`; for LID chats prefer `canonicalId`. If piped JSON is incomplete, capture the exit status and installed version; do not assume the historical 64 KB truncation bug. Backfilling missing media is a batch operation; account contacts/groups and sync are instance operations.

Inspect `omni tts --help`, `omni speak --help` and `omni voice --help` for current providers and options. `omni tts voices --json` discovers voices; `speak` and `send --tts` deliver audio and require an authorized target. Inside a turn use verbs with the preset context; out of turn use an explicit target. Scheduled delivery is separate (`omni schedule --help`) and requires the same recipient authorization.
