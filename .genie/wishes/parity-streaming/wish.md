# Wish: WhatsApp Response Streaming

**Status:** READY  
**Slug:** parity-streaming  
**Created:** 2026-02-13  
**Depends on:** channel-parity-telegram-whatsapp  
**Complexity:** L  

---

## Problem

WhatsApp has no response streaming support. Telegram already has a fully implemented `TelegramStreamSender` (in `senders/stream.ts`) that performs progressive message edits with throttled updates and thinking blockquotes. WhatsApp declares no `canStreamResponse` capability and has no `createStreamSender()` method, even though Baileys supports both `sendMessage` and `editMessage` — making progressive edits technically feasible.

Without streaming, WhatsApp users get a single large message dump after the full LLM response completes, while Telegram users see the response being typed out in real time. This is the single largest UX gap between the two channels.

## Audit Evidence

- **Telegram reference implementation:** `TelegramStreamSender` in `packages/channel-telegram/src/senders/stream.ts` — implements `StreamSender` interface with `start()`, `push(chunk)`, `end()` lifecycle. Uses `editMessageText()` for progressive updates with a throttle interval.
- **WhatsApp gap:** No `createStreamSender()` factory, no `canStreamResponse` in capabilities, no stream-related code.
- **Baileys capability:** `sock.sendMessage()` creates initial message, `sock.sendMessage()` with `edit` key updates it. Both are production-tested (edit is used for message corrections already).

## Scope

### IN

- [ ] Implement `WhatsAppStreamSender` class implementing the `StreamSender` interface
- [ ] Use Baileys `sendMessage` for initial message, `editMessage` for progressive updates
- [ ] Throttle edits to respect WhatsApp rate limits (more conservative than Telegram — suggest 2-3s minimum interval)
- [ ] Handle thinking blockquotes (match Telegram behavior)
- [ ] Set `canStreamResponse: true` in WhatsApp plugin capabilities
- [ ] Wire `createStreamSender()` factory method in WhatsApp plugin
- [ ] Integrate with existing `humanDelay()` anti-bot system (streaming replaces delay)
- [ ] Handle edge cases: message too long mid-stream (split), connection drop during stream, edit failure fallback
- [ ] Test with actual LLM streaming responses

### OUT

- Streaming for media messages (text-only for now)
- WhatsApp Web UI progressive rendering (that's client-side, we can't control it)
- Changing the `StreamSender` interface itself (must conform to existing contract)
- Streaming for group messages (start with 1:1, extend later)

## Acceptance Criteria

- [ ] `WhatsAppStreamSender` implements `StreamSender` interface (`start`, `push`, `end`)
- [ ] Progressive edits visible in WhatsApp client during LLM response generation
- [ ] Edit throttle interval is configurable per instance (default 2500ms)
- [ ] Graceful fallback: if `editMessage` fails, accumulate and send as new message
- [ ] No infinite edit loops or rate limit violations
- [ ] `canStreamResponse` is `true` in WhatsApp capabilities
- [ ] Existing Telegram streaming behavior unchanged
- [ ] Smart message splitting works mid-stream if response exceeds `maxMessageLength`

## Library Blockers

- **Baileys `editMessage` reliability:** Baileys edit support exists but may have edge cases with older WhatsApp versions. Need to test thoroughly and implement fallback.
- **WhatsApp rate limits on edits:** No official documentation on edit rate limits. Conservative throttle required. If WhatsApp throttles aggressively, may need to increase interval dynamically.
