# Communication examples

Read `omni --help`, choose the command matching the requested outcome, then check its help before using an example below. Examples are not a complete command inventory. Preserve the selected server, instance, recipient and turn context.

Verb commands for agents replying inside a conversation. In turn-based mode the bridge pre-sets the context — no `omni use` / `omni open` needed; every verb routes automatically.

| Env var | Meaning |
|---------|---------|
| `OMNI_INSTANCE` | Channel instance ID (which WhatsApp/Telegram account) |
| `OMNI_CHAT` | Chat JID (the conversation) |
| `OMNI_MESSAGE` | Inbound message ID that triggered this turn |
| `OMNI_TURN_ID` | Current turn ID, used by `omni done` to close the correct turn |

Out-of-turn (cron, manual): set context first — `omni use <instance-id>`, `omni open <chat-jid>`; check with `omni where`.

## Verbs

```bash
omni say "Your order shipped yesterday."             # text to the open chat; --reply [msg-id] quote-replies
omni speak "Welcome!" --voice Kore --language pt-BR  # TTS voice note (providers: gemini, openai, elevenlabs)
omni imagine "a city skyline at sunset"              # generate + send image
omni film "waves crashing in slow motion"            # generate + send video (Veo)
omni music "calm lo-fi with rain"                    # generate + send audio (Lyria)
omni react "👍" --message <id>                       # emoji reaction; defaults to the trigger message
omni see /path/img.jpg "what product is this?"       # describe image/video (Gemini Vision)
omni listen /path/audio.ogg --language pt            # transcribe an audio file
omni history --limit 20 --json                       # recent messages; --before <msg-id> paginates
omni done "Final answer."                            # send final message + close turn — ATOMIC
```

## Closing the turn — omni done

REQUIRED as the last action of every turn; without it the turn hangs until server timeout.

- `omni done "<text>"` — sends `<text>` to the user as the final message AND closes the turn. Preferred.
- `omni done --skip --reason "nothing to add"` — close silently.
- `omni done --react "👍"` — close with a reaction only.
- `omni done --media <path> --caption "<text>"` — close with media.

## In-turn rules

- When `OMNI_INSTANCE` is set, replies must use Omni verbs; bare assistant output is never delivered to the chat.
- Never call `omni use` or `omni open` inside a turn: the bridge already set the context.
- Get message IDs from `omni history --json` before reacting. Multiple outbound verbs may precede `omni done`, which must be the last action.

## Turn lifecycle

1. Bridge delivers the message (env vars set).
2. `omni history --limit 5` if you need context.
3. Reply with verbs (`say`, `speak`, `imagine`, ...) for mid-turn updates.
4. `omni done "<final>"` — always last.

Exit 0 confirms the command succeeded; report channel delivery only when its receipt or an observed message confirms it. Use `omni turns --help` to inspect turn-management commands, not to bypass the assigned turn context.

## Send edge cases

`omni send` targets any recipient (`--to` accepts a phone, WA JID, or chat/person UUID; `--instance <id>` picks the account). Inside a turn prefer verbs — `send` bypasses turn tracking.

```bash
omni send --to +5511999999999 --text "Hi" --instance <id>
omni send --media ./doc.pdf --caption "The document" --to <chat>
omni send --tts "Spoken version of this text" --to <chat>
omni send --location --lat -23.5505 --lng -46.6333 --address "Av. Paulista" --to <chat>
omni send --poll "Which option?" --options "A,B,C" --to <chat>      # Discord
omni send --sticker <url-or-base64> --to <chat>
omni send --contact --name "Ana" --phone +5511888887777 --to <chat>
omni send --reaction "❤️" --message <id>
omni send --to <chat> --text "Reply" --reply-to <message-id>
omni send --to <chat> --forward --message <message-id> --from-chat <source-chat>
omni send --to <chat> --text "Update" --sent-by agent
omni send --to <chat> --embed --title "Status" --description "Ready"  # Discord
omni send --to <chat> --presence typing
```

## Messages and chats

```bash
omni messages search "refund request" --since 7d   # full-text, includes transcriptions/descriptions
omni messages get <id>                             # full message detail
omni messages read <id>                            # send read receipt
omni chats list --unread                           # also --sort activity|unread|name, --attention
omni chats get <id>
omni chats messages <chatId> --json                # read any chat, not just the open one
```

More via `omni messages --help` (`edit`, `delete`, `star`, `unstar`, `remove-reaction`, `close-contact`) and `omni chats --help` (`archive`, `pin`, `mute`, `label`, `participants`, `read`).

For chat search/filter templates and TTS voice discovery, read [message browsing and voices](messages.md).

`messages close-contact` records a terminal outcome or cooldown and may send a farewell: inspect `omni messages close-contact --help` and confirm the intended recipient/outcome before using it.

For capabilities beyond these examples, discover options through `omni send --help`, `omni speak --help`, `omni film --help`, `omni music --help`, `omni schedule --help`, `omni voice --help`, `omni media --help`, `omni a2a --help`, or `omni slack --help`. Scheduled sends and other outbound actions need the same target/authorization checks as an immediate send. Use global `--server <name>` to select an existing credentialed server; see setup for registration and current keyless-login limitations.
