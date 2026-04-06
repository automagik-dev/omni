---
name: omni-agent
description: "Agent communication toolkit — verb commands for WhatsApp, Telegram, Discord, Slack. Say, speak, imagine, react, listen, see, history, done."
allowed-tools: Bash(omni *)
---

# Omni Agent — Verb Reference

Concise command reference for AI agents operating in turn-based mode. All verbs target the current conversation context (set via env vars).

## Verb Commands

### omni say — Send text reply
```bash
omni say "Hello, how can I help?"
```
Send a text message to the current chat. Supports markdown formatting.

### omni speak — Send voice note
```bash
omni speak "Welcome to our service" --voice Kore --language pt-BR
```
Generate a voice note via Gemini TTS and send it. Available voices: Kore, Charon, Aoede, Fenrir, Puck, and others. Defaults to English if `--language` is omitted.

### omni imagine — Generate and send image
```bash
omni imagine "a futuristic city skyline at sunset"
```
Generate an image via Gemini and send it to the current chat. Provide a descriptive prompt for best results.

### omni react — React to a message
```bash
omni react "👍" --message 3A01B2C3D4E5F6
```
Add an emoji reaction to a specific message. Use `omni history` first to get message IDs.

### omni see — Describe image or video
```bash
omni see /path/to/image.jpg "What product is shown here?"
```
Analyze an image or video file via Gemini Vision. The optional prompt guides the description. Useful for processing received media.

### omni listen — Transcribe audio
```bash
omni listen /path/to/audio.ogg --language pt
```
Transcribe an audio file via Groq Whisper. Use `--language` to hint the spoken language for better accuracy.

### omni history — Read conversation messages
```bash
omni history --limit 20 --json
```
Retrieve recent messages from the current chat. Returns message IDs, senders, timestamps, and content. Use `--before <id>` to paginate backwards. Use `--json` for machine-readable output.

### omni done — Close the turn
```bash
omni done "Handled customer inquiry about pricing"
```
Signal that the agent has finished processing the current message. **REQUIRED as the last action in every turn.** The optional text is logged as a summary but not sent to the user.

## Send Edge Cases

For message types not covered by verbs, use `omni send` directly:

```bash
omni send --media /path/to/file.pdf --caption "Here is the document"
omni send --poll "Which option?" --options "A,B,C"
omni send --location -23.5505 -46.6333 --name "Office"
omni send --sticker /path/to/sticker.webp
omni send --reaction "❤️" --message <id>
```

## Message Operations

```bash
omni messages search "refund request"     # Full-text search across messages
omni messages get <id>                     # Get a specific message by ID
omni messages read <id>                    # Send read receipt for a message
```

## Chat Operations

```bash
omni chats list                            # List all chats for the current instance
omni chats list --unread                   # List chats with unread messages
omni chats get <id>                        # Get chat details (name, participants, metadata)
```

## Turn-Based Lifecycle

The standard agent turn follows this pattern:

1. **Receive** — Bridge delivers a message event to the agent
2. **Context** — `omni history` to load recent conversation (optional, for context)
3. **Process** — Understand intent, query data, reason about the reply
4. **Reply** — Send one or more responses via verbs (`say`, `speak`, `imagine`)
5. **Close** — `omni done` to signal turn completion (REQUIRED)

Example turn:
```bash
omni history --limit 5          # See what was said recently
omni say "Your order #1234 shipped yesterday. Tracking: XYZ789."
omni done "Answered shipping status question"
```

## Context

In turn-based mode, these environment variables are pre-set by the bridge:

| Variable | Purpose |
|----------|---------|
| `OMNI_INSTANCE` | Channel instance ID (identifies which WhatsApp/Telegram/etc. account) |
| `OMNI_CHAT` | Chat JID (identifies the conversation) |
| `OMNI_MESSAGE` | Inbound message ID (the message that triggered this turn) |
| `OMNI_AGENT` | Agent identifier (your agent name) |

These are injected automatically — there is no need to run `omni use` or `omni open` in turn-based mode. All verb commands read these env vars to route messages to the correct destination.
