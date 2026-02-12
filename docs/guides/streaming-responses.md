# Streaming Responses (Telegram)

Progressive response rendering for Telegram channels. Instead of waiting for the full response, users see thinking and content appear in real time.

## How It Works

1. Agent starts thinking → `<blockquote expandable>🧠 Thinking...` appears
2. Agent starts responding → thinking collapses, response builds with cursor `█`
3. Agent finishes → clean final message with collapsed thinking + full response

Short thinking (<2s) is skipped to avoid visual noise.

## Enable Streaming

### Per Instance (SQL)

```sql
UPDATE instances
SET agent_stream_mode = true
WHERE name = 'your-telegram-instance';
```

### Per Instance (API)

```bash
curl -X PATCH "https://your-api/api/v2/instances/<instance-id>" \
  -H "Content-Type: application/json" \
  -H "x-api-key: <your-key>" \
  -d '{"agentStreamMode": true}'
```

### Via CLI

```bash
omni instances update <instance-id> --agent-stream-mode true
```

## Requirements

- Channel must support `editMessage` (currently: Telegram only)
- Provider must support `triggerStream()` (currently: OpenClaw only)
- Instance must have `agentStreamMode: true`

If any requirement is not met, the instance silently falls back to the standard accumulate-then-reply mode.

## Rate Limits

Telegram edit throttle is adaptive:
- **DMs:** ~900ms between edits
- **Groups:** ~3000ms between edits (Telegram's stricter group rate limit)

429 errors are handled with exponential backoff. If rate limiting persists, edits are skipped and the sender catches up on the next tick.

## Thinking Display

- Thinking appears in `<blockquote expandable>` (Telegram Bot API 7.10+)
- Only shown if thinking phase lasts ≥2 seconds
- Truncated to last 600 chars in the final collapsed block
- Shows duration: "🧠 Thought (4.2s)"
- Old Telegram clients see regular blockquote (graceful degradation)

## Message Length

- Telegram max: 4096 chars per message
- During streaming: tail-window shows last ~3800 chars with `⏳ ...` header
- Final message: auto-split into multiple messages if over 4096 chars

## Troubleshooting

**Streaming not working:**
1. Check `agentStreamMode` is `true` on the instance
2. Check the provider supports `triggerStream()` (OpenClaw only)
3. Check the channel plugin has `capabilities.canStreamResponse: true`

**Rate limit errors:**
- Reduce concurrent streaming instances in the same group
- The sender backs off automatically; errors are logged at `telegram:sender:stream`

**Thinking not showing:**
- Thinking phase was < 2 seconds (skipped by design)
- The agent may not have reasoning enabled (check OpenClaw agent config)
