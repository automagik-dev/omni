# Design: Presence-Debounce Inbound Batching — Close the Gaps in the Existing Debouncer

| Field | Value |
|-------|-------|
| **Status** | PROPOSED (v2 — corrected after plan review) |
| **Scope** | `packages/api` (message-debouncer + agent-dispatcher), `packages/db` (config), docs/CLI |
| **Author** | Felipe + Genie |
| **Date** | 2026-07-03 |
| **Grounded in** | omni source (file:line refs below), verified by independent plan review |

## TL;DR — the feature mostly already exists

omni **already** batches inbound WhatsApp messages presence-aware. This doc's v1 proposed building it fresh in `channel-whatsapp`; that was wrong (verified). The real work is a **small, targeted extension** of the existing debouncer plus enablement/docs — NOT a new subsystem and NOT a message-schema change.

## What already ships (verified)

- **`packages/api/src/plugins/message-debouncer.ts`** — `MessageDebouncer` buffers `BufferedMessage[]` per `instanceId:chatId` and flushes the batch as one agent turn. Modes `disabled | fixed | randomized`; `restartOnTyping: boolean`; a post-flush re-flush guard (`inFlight` + finally-block, ~:129-143).
- **`packages/api/.../agent-dispatcher.ts`** — wires it: `message.received → debouncer.buffer`, **`presence.typing → debouncer.onUserTyping`** (~:5287-5318), and flushes N buffered messages into `processAgentResponse(..., messages, ...)` (`:3445`, `:5026`). So the burst-of-messages → one-turn behavior the agent sees is **already implemented**.
- **Per-instance/route config in the DB**: `message_debounce_mode/_min_ms/_max_ms/_group_ms/_restart_on_typing` (`packages/db/src/schema.ts:402-406, 749-755`), read via `getDebounceConfig()` (`agent-dispatcher.ts:387`), CLI-settable (`packages/cli/src/commands/instances.ts:94`).
- **The presence signal** is piped end-to-end: `channel-whatsapp` `presence.update` → `handlePresenceUpdate` → publishes `presence.typing` (`all-events.ts:83`, `plugin.ts:3347`) → dispatcher → `onUserTyping`.
- **`message.received` is single-media** (`content = {type,text?,mediaUrl?,mimeType?,localPath?,...}`, `core/src/events/types.ts:200`). Coalescing does NOT need a schema change — the dispatcher assembles the turn from the `BufferedMessage[]` array. (v1's "emit one coalesced message with a media array" is retracted — it would have changed the canonical core event consumed by all 7 channels + the SDK.)
- A **second, richer** presence debouncer exists but is NOT on the active WhatsApp-inbound path: `packages/core/src/automations/debounce.ts` `DebounceManager` mode `presence` with `maxWaitMs` + `extendOnEvents` (`automations/types.ts:157`).

**Your exact ask — "accumulate while the user is typing, flush 5s after they stop" — is achievable today** with `mode=fixed, restartOnTyping=true, minMs=5000`: each `presence.typing` force-restarts the window; when typing stops, it flushes after `minMs`.

## The genuine gaps (this is the actual work)

1. **No hard `maxWaitMs` cap** in `message-debouncer.ts` — a user who types continuously never flushes (the timer keeps restarting on `restartOnTyping`). The richer `presence` mode in `core/automations/debounce.ts` already models `maxWaitMs`; the active debouncer lacks it. → Add a max-wait cap: flush at the latest `maxWaitMs` from the FIRST buffered message, regardless of ongoing typing.
2. **`clear()` drops buffered messages on shutdown** (`message-debouncer.ts:147-150` clears buffers + timers without flushing) → messages lost on disconnect/restart. → Add `flushAll()` that flushes pending batches before clearing, called on `connection.update: close` + teardown. *(This is the one genuinely net-new correctness fix.)*
3. **Discoverability / enablement** — the capability is DB/CLI config with no obvious "typing debounce" switch. → Add a named `presence` mode to the active debouncer that is sugar for `fixed + restartOnTyping + maxWaitMs`, so operators get one intuitive toggle matching "user-is-typing debounce," plus docs + env/CLI exposure.
4. **(Optional) Reconcile the two debouncers** — `api/message-debouncer.ts` (active) vs `core/automations/debounce.ts` (richer `presence` mode, unwired). Either port `presence`+`maxWaitMs` into the active one (preferred — one code path) or document which is authoritative. Avoid a third implementation.

## Plan

1. **`message-debouncer.ts`**: extend `DebounceConfig` with `maxWaitMs: number | null` and add a `presence` mode (= fixed window + `restartOnTyping` + max-wait cap). Track `firstBufferedAt` per chatKey; in `restartTimer`, clamp the next fire so it never exceeds `firstBufferedAt + maxWaitMs`. Preserve the existing re-flush guard.
2. **`clear()` → keep for teardown, add `flushAll(): Promise<void>`** that awaits a flush of every non-empty buffer, then clears. Wire `flushAll` into the dispatcher/plugin shutdown + `connection.update: close`.
3. **`packages/db/src/schema.ts`**: add `message_debounce_max_wait_ms` (or document reusing `message_debounce_max_ms` as the cap for `presence` mode); extend `getDebounceConfig()` + the CLI (`instances.ts`) + API to accept it and `mode=presence`.
4. **Docs**: a short guide — "Typing-aware inbound batching": enable via `mode=presence` (or `fixed+restartOnTyping`), tune `minMs` (quiet window, default 5000) + `maxWaitMs` (cap, default 30000); note the genie/agent benefit (one turn per human burst; no consumer change).

## Tests

- `message-debouncer.test.ts` (injectable clock): fixed+restartOnTyping flushes `minMs` after last typing; `presence` mode caps at `maxWaitMs` under continuous typing; `flushAll()` emits pending instead of dropping (the shutdown gap); per-`instanceId:chatId` isolation preserved; re-flush guard still prevents double-dispatch; `disabled` mode = immediate passthrough parity.
- Dispatcher integration: interleaved `message.received` + `presence.typing` → one `processAgentResponse` per turn; a `connection.close` mid-buffer flushes rather than drops.

## Non-goals

- No change to the `message.received` schema / no `attachments[]` or `batch` field (retracted from v1) — coalescing already happens over `BufferedMessage[]`.
- No new `channel-whatsapp` debouncer module (retracted — presence is already piped to the api-layer debouncer).
- No change to outbound `WHATSAPP_TYPING_SIMULATION` (that is the bot's OUTBOUND typing; unrelated).
- Group-chat batching keeps today's `instanceId:chatId` keying + `message_debounce_group_ms`; per-sender group batching is a separate future item.

## Consumer impact

genie (and any agent) needs **zero change** — it already receives one turn per flush via `processAgentResponse`. This work makes that turn (a) reliably close a fixed window after typing stops with a hard cap, and (b) never lose a buffered tail on shutdown. Default config stays as-is; `presence` mode is opt-in per instance.
