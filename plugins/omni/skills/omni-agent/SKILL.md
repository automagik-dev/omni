---
name: omni-agent
description: "Agent communication toolkit — verb commands for WhatsApp, Telegram, Discord, Slack. Say, speak, imagine, react, listen, see, history, done."
allowed-tools: Bash(omni *)
---

# Omni Agent — Verbs

Verb commands for agents replying inside a conversation. In turn-based mode the bridge pre-sets the context — no `omni use` / `omni open` needed; every verb routes automatically.

| Env var | Meaning |
|---------|---------|
| `OMNI_INSTANCE` | Channel instance ID (which WhatsApp/Telegram account) |
| `OMNI_CHAT` | Chat JID (the conversation) |
| `OMNI_MESSAGE` | Inbound message ID that triggered this turn |
| `OMNI_AGENT` | Your agent identifier |

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

## Turn lifecycle

1. Bridge delivers the message (env vars set).
2. `omni history --limit 5` if you need context.
3. Reply with verbs (`say`, `speak`, `imagine`, ...) for mid-turn updates.
4. `omni done "<final>"` — always last.

A message counts as sent when the command exits 0 — report delivery only after that.

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

More via `omni messages --help` (`edit`, `delete`, `star`, `remove-reaction`) and `omni chats --help` (`archive`, `pin`, `mute`, `label`, `participants`, `read`).
