# Typing-Aware Inbound Batching (Presence Debounce)

When a human sends a burst of short messages — "hi", "quick question", "about my
order", "#12345" — you usually want the agent to see them as **one turn**, not
fire four separate replies. omni's message debouncer already batches inbound
messages per `instanceId:chatId` and hands the whole batch to the agent as a
single dispatch. The **`presence`** mode makes that batching typing-aware:
accumulate while the user is still composing, flush shortly after they stop.

## How it works

The debouncer buffers incoming messages and starts a quiet-window timer.

- Each `presence.typing` event (piped end-to-end from the channel) **restarts**
  the quiet window, so the batch grows for as long as the user keeps typing.
- When typing stops, the batch flushes `minMs` later (the quiet window).
- A hard **`maxWaitMs`** cap, measured from the *first* buffered message,
  guarantees a flush even if the user never stops typing — so a
  continuously-composing user can't starve the agent forever.

`presence` mode is sugar for `fixed` + `restartOnTyping` + the `maxWaitMs` cap.
You can achieve the same behavior manually with
`mode=fixed, restartOnTyping=true, minMs=5000` plus a `maxWaitMs` value — but
`presence` gives operators a single intuitive toggle with sensible defaults.

## Enable it

### Defaults

Selecting `presence` mode applies these defaults when the tuning columns are
left unset:

| Setting | Default | Meaning |
|---------|---------|---------|
| `minMs` | `5000` | quiet window — flush 5s after the user stops typing |
| `maxWaitMs` | `30000` | hard cap — flush at most 30s after the first message |

Override either to taste.

### Via CLI

```bash
omni instances update <instance-id> \
  --debounce-mode presence \
  --debounce-min 5000 \
  --debounce-max-wait 30000
```

### Per instance (API)

```bash
curl -X PATCH "https://your-api/api/v2/instances/<instance-id>" \
  -H "Content-Type: application/json" \
  -H "x-api-key: <your-key>" \
  -d '{
        "messageDebounceMode": "presence",
        "messageDebounceMinMs": 5000,
        "messageDebounceMaxWaitMs": 30000
      }'
```

### Per route override

`presence` mode and `messageDebounceMaxWaitMs` are also settable as per-route
overrides on `agent_routes` (null = inherit from the instance), so a specific
chat or user can use typing-aware batching while the instance default stays
`disabled`/`randomized`.

## Tuning

- **`minMs` (quiet window)** — how long to wait after the last keystroke/message
  before dispatching. Higher = fewer, larger batches; lower = snappier replies.
- **`maxWaitMs` (hard cap)** — the ceiling on total batch age. Prevents a
  never-ending typer from indefinitely delaying the agent. Set `null` for no cap
  (not recommended for `presence` mode).

## Requirements

- The channel must emit typing presence. For WhatsApp this is piped
  automatically (`presence.update` → `presence.typing` → the debouncer). Channels
  that don't emit typing simply fall back to the `minMs` window with no restarts.

## Consumer impact

**Zero change for agents.** The agent (and the genie/SDK consumers) already
receives one turn per flush via the normal dispatch path — this only changes
*when* that turn closes. Nothing downstream needs to know a batch was
typing-debounced.

Buffered messages are also **no longer dropped on shutdown**: graceful teardown
now drains pending batches (`flushAll`) instead of discarding them, so a burst
that lands moments before a restart is still delivered.
