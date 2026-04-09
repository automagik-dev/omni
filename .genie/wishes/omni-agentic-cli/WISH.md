# Wish: Omni Turn-Based Execution — Agentic CLI + Turn Protocol

| Field | Value |
|-------|-------|
| **Status** | READY |
| **Slug** | `omni-agentic-cli` |
| **Date** | 2026-04-05 |
| **Design** | [DRAFT.md](../../brainstorms/generate-image-native/DRAFT.md) |
| **Issues** | #259 |
| **coordinates-with** | Genie `unified-omni-bridge` (Groups 2-4, genie repo) |

## Summary

Omni today has two agent execution modes: **round-trip** (send, wait, get response) and **fire-and-forget** (send, agent replies whenever). Both are primitives. Neither gives the agent a real working environment.

This wish adds a third mode: **turn-based**. When a message arrives and the dispatcher opens a turn-based session, Omni automatically creates an isolated, pre-configured sandbox for the agent: a scoped API key locked to one instance, env vars that route every command to the right chat, a full set of verb commands for multimodal communication, and a turn lifecycle that monitors, nudges, and enforces completion. The agent can send text, voice, images, video, react, transcribe, describe — all without knowing a single ID. It just talks. And when it's done, it says `omni done`.

This is what makes Omni an agentic platform, not just a message router. Any agent system — Genie, a webhook agent, an A2A agent, a custom SDK — can opt into turn-based mode and get the same sandbox. Genie is the first consumer. It won't be the last.

## The Three Modes

| Mode | How it works | Agent gets | Use case |
|------|-------------|-----------|----------|
| **round-trip** | Send → wait → get response | Nothing. Provider returns text. | Simple bots, FAQ, stateless. |
| **fire-and-forget** | Send → return immediately → agent replies via NATS | NATS topic. That's it. | Current Genie bridge. No lifecycle. |
| **turn-based** | Send → open turn → agent has full environment → closes with `done` | Scoped key, env vars, verb commands, turn tracking, nudge, timeout | Agentic assistants at scale. |

```typescript
// packages/core/src/providers/types.ts
interface IAgentProvider {
  readonly mode: 'round-trip' | 'fire-and-forget' | 'turn-based';
  // ...
}
```

## The Turn Environment

When the dispatcher opens a turn-based session, Omni sets up:

```
┌──────────────────────────────────────────────────────────────┐
│  TURN SANDBOX (auto-configured by Omni per message)          │
│                                                              │
│  Identity:                                                   │
│    OMNI_API_KEY    = scoped key (this instance ONLY)         │
│    OMNI_INSTANCE   = instance that received the message      │
│    OMNI_CHAT       = chat the human wrote in                 │
│    OMNI_MESSAGE    = trigger message (for --reply/react)     │
│                                                              │
│  During-turn commands (send intermediate messages):          │
│    omni say "..."           text                             │
│    omni send file.jpg       media                            │
│    omni speak "..."         voice note (TTS, any provider)   │
│    omni imagine "..."       generate image                   │
│    omni film "..."          generate video                   │
│    omni listen audio.ogg    transcribe (→ stdout)            │
│    omni see photo.jpg       describe (→ stdout)              │
│    omni react 👍            react                            │
│                                                              │
│  Turn-closing command (REQUIRED):                            │
│    omni done "final text"        send + close                │
│    omni done --react ✅          react + close               │
│    omni done --skip              close silently               │
│                                                              │
│  Isolation:                                                  │
│    API key scoped to ONE instance — can't message others     │
│    Turn tracked: nudge at 60s, fallback at 300s, close 900s  │
│    Zero bleed between users, chats, or instances             │
└──────────────────────────────────────────────────────────────┘
```

## The Turn Lifecycle

```
MESSAGE ARRIVES
  ├─ Dispatcher sees mode: 'turn-based'
  ├─ Opens turn: records start time, stores in PG
  ├─ Provisions env: scoped API key + OMNI_INSTANCE/CHAT/MESSAGE
  ├─ Fires provider.trigger(context) with env vars in payload
  │
DURING TURN (agent active)
  ├─ Agent sends intermediate: omni say/send/speak/imagine/react
  ├─ Agent uses internal tools: researches, plans, reads files
  ├─ Omni tracks turn: any API call from scoped key = activity
  │
  ├─ [60s no API activity] → Omni emits nudge event on NATS
  ├─ [120s] → Second nudge
  ├─ [300s] → Omni sends fallback to user: "⏱ Still processing..."
  ├─ [900s] → Force-close: emit turn.timeout event
  │
TURN CLOSE (one of)
  ├─ omni done "text"    → send final message + emit turn.done
  ├─ omni done --react ✅ → react to trigger + emit turn.done
  ├─ omni done --skip    → emit turn.done, no outbound
  ├─ 900s timeout        → emit turn.timeout, fallback sent
  │
AFTER TURN
  ├─ Turn audit event: { action, duration, nudgeCount, messagesSent }
  ├─ Session goes idle → ready for next message
  └─ Scoped key stays valid (reused for next turn on same agent)
```

## Inactivity Detection

"Activity" = the agent is doing something. Not that it messaged the user.

| Signal | How detected |
|--------|-------------|
| API call from scoped key | Auth middleware logs `lastUsedAt` on `api_keys` (already exists) |
| NATS message from agent | Bridge monitors `omni.reply.*` (existing) |
| Turn still open | `turns.last_activity_at` in PG, polled by turn monitor |

The nudge is delivered via NATS to the agent's bridge topic. The bridge (Genie or any consumer) is responsible for injecting it into the agent's execution context.

## NATS Events

| Event | Topic | Payload |
|-------|-------|---------|
| Turn opened | `omni.turn.open.{instanceId}.{chatId}` | `{ turnId, messageId, agentId, timestamp }` |
| Turn done | `omni.turn.done.{instanceId}.{chatId}` | `{ turnId, action, messageId?, emoji?, reason?, duration, nudgeCount }` |
| Turn nudge | `omni.turn.nudge.{instanceId}.{chatId}` | `{ turnId, nudgeCount, idleSec, message }` |
| Turn timeout | `omni.turn.timeout.{instanceId}.{chatId}` | `{ turnId, duration, nudgeCount, fallbackSent }` |

All on plain NATS (same as existing `omni.message.*` and `omni.reply.*`), not JetStream. Real-time signaling.

## Scope

### IN
1. **Turn-based execution mode** — third mode on `IAgentProvider`, dispatcher handling, turn lifecycle
2. **Turn state in PG** — `turns` table: open/close, activity tracking, nudge count, audit
3. **Turn monitor** — polls for stale turns, emits nudge/timeout events via NATS
4. **`omni done` command** — turn-closing CLI command, sends final message + emits `turn.done` NATS event
5. **9 verb commands** — `say`, `send`, `speak`, `react`, `imagine`, `film`, `listen`, `see`, `done`
6. **Conversation context** — `omni open/use/where/close`, PG-backed per API key, env var override
7. **Provider framework** — interfaces for TTS/STT/ImageGen/VideoGen/Vision + registry + config
8. **Gemini providers** — Nano Banana 2 image gen, TTS, STT, Veo 3.1 video gen, vision
9. **Existing provider adapters** — ElevenLabs TTS + Groq Whisper STT in provider interfaces
10. **Instance scoping enforcement** — `api_keys.instanceIds` enforced across all routes
11. **Auto-provisioned agent keys** — agent-instance assignment auto-creates scoped key
12. **Persons CLI** — `omni persons merge/link/unlink/update` (API exists, CLI missing)
13. **Smarter auto-linking** — @lid → phone uses existing person instead of creating duplicates
14. **Full coexistence** — old `omni send --text --instance --to` unchanged, turn-based is opt-in

### OUT
- Genie-side bridge changes (Groups 2-4 of `unified-omni-bridge` — genie repo)
- Replacing ElevenLabs or Groq — they remain as providers
- Music generation (Lyria), live/streaming modes
- Multi-turn image editing (Gemini thought signatures)
- Non-Gemini image/video gen providers
- Person deduplication bulk UI
- Breaking changes to existing CLI or API

## Decisions

| Decision | Rationale |
|----------|-----------|
| Turn-based as a third provider mode | Not a hack on top of fire-and-forget. A first-class execution model any agent system can use. Clean separation from existing modes. |
| Turn state in PG, signals via NATS | PG for durability (survives restarts), NATS for real-time (fast turn close/nudge). Same pattern as events + messaging. |
| `omni done` as the single turn-closing command | Unmistakable ("I'm done"), unified (text/react/skip), enforceable (system prompt + nudge), doesn't conflict with existing commands. |
| Inactivity = no API calls from scoped key | `api_keys.lastUsedAt` already updated on every request. No new instrumentation needed. |
| Nudge via NATS, not in-process | Omni doesn't know what executor the agent uses (SDK, tmux, webhook). NATS is the universal signal. Bridge injects the nudge. |
| 9 verbs (8 during-turn + done) | Each does one thing. `--reply` composes. `done` closes. Zero redundancy. |
| Provider-agnostic verbs with config defaults | `speak` doesn't know ElevenLabs vs Gemini. Future providers plug in without changing verbs. |
| Context in PG on api_keys, not files | Already have PG. No race conditions, permission-aware. |
| `omni use` for instance selection (admin only) | Scoped agents have one instance. Admins juggle multiple. |
| Auto-provisioned agent keys on instance assignment | Instance assignment = automatic scoping. Zero manual key management. |
| Env vars override PG context | Agents get per-process isolation (dispatcher sets env). Humans get persistence (`omni open`). |

## Success Criteria

### Turn Protocol
- [ ] `IAgentProvider.mode` supports `'turn-based'` as third value
- [ ] Dispatcher opens a turn when mode is turn-based, stores in PG
- [ ] Turn includes env vars in trigger context: `OMNI_API_KEY`, `OMNI_INSTANCE`, `OMNI_CHAT`, `OMNI_MESSAGE`
- [ ] `omni done "text"` sends final message + emits `omni.turn.done` NATS event
- [ ] `omni done --react ✅` reacts to trigger + emits `turn.done`
- [ ] `omni done --skip` emits `turn.done` with no outbound
- [ ] Turn nudge emitted at 60s of no API activity from scoped key
- [ ] Turn force-closed at 900s with fallback message to user
- [ ] Turn audit event includes: action, duration, nudgeCount, messagesSent

### Verb Commands + Context
- [ ] `omni open <contact> && omni say "test"` delivers text to correct chat
- [ ] `omni use <instance>` sets active instance, persisted in PG
- [ ] `omni where` shows current instance + chat + channel
- [ ] `omni say "text" --reply` sends quote-reply to trigger message
- [ ] `omni send file.jpg` delivers media to open chat
- [ ] `omni speak "hello"` generates voice via default TTS provider and sends
- [ ] `omni speak "hello" --provider gemini` forces Gemini TTS
- [ ] `omni speak "hello" --provider elevenlabs` forces ElevenLabs
- [ ] `omni react 👍` reacts to last message
- [ ] `omni imagine "a cat"` generates image via Nano Banana 2 and sends
- [ ] `omni imagine "a cat" --output cat.png` saves locally without sending
- [ ] `omni film "sunset"` generates video via Veo 3.1 and sends
- [ ] `omni listen audio.ogg` returns transcription to stdout
- [ ] `omni listen audio.ogg --reply` transcribes + sends as quote-reply
- [ ] `omni see photo.jpg` returns description to stdout

### Infrastructure
- [ ] Scoped API key gets 403 on unauthorized instance across all routes
- [ ] Agent-instance assignment auto-provisions scoped API key
- [ ] `omni persons merge <a> <b>` merges two persons
- [ ] `omni persons update <id> --phone "+55..."` updates person fields
- [ ] `omni config set tts.provider gemini` → subsequent `omni speak` uses Gemini
- [ ] `omni send --text "hi" --instance X --to Y` still works (coexistence)
- [ ] Closes #259

### Quality Gates
- [ ] All existing tests pass: `bun test`
- [ ] TypeScript compiles: `bunx tsc --noEmit`
- [ ] `bun run build` succeeds across all packages

## Execution Strategy

### Wave 1 — Foundation (all parallel, zero dependencies)
| Group | Agent | Description |
|-------|-------|-------------|
| 1 | engineer | Provider framework — interfaces, Gemini SDK, registry, config |
| 2 | engineer | Context layer — PG schema, API endpoints, open/use/where/close CLI |
| 3 | engineer | Instance scoping — enforce all routes, auto-key provisioning |
| 4 | engineer | Persons & linking — CLI commands + smarter auto-linking |
| 5 | engineer | Turn infrastructure — turns table, turn service, turn monitor, NATS events |

### Wave 2 — Commands + Providers (all parallel, depends on Groups 1+2+5)
| Group | Agent | Description |
|-------|-------|-------------|
| 6 | engineer | Core verbs — say, send, react + --reply modifier + context resolution |
| 7 | engineer | done — turn-closing command + NATS event emission |
| 8 | engineer | speak — multi-provider TTS (Gemini + ElevenLabs adapter) |
| 9 | engineer | listen — multi-provider STT (Gemini + Groq adapter) |
| 10 | engineer | imagine — Gemini image gen (Nano Banana 2) |
| 11 | engineer | see — Gemini vision |
| 12 | engineer | film — Gemini video gen (Veo 3.1, async) |

### Wave 3 — Integration + Dispatcher
| Group | Agent | Description |
|-------|-------|-------------|
| 13 | engineer | Wire turn-based mode into dispatcher — env var injection, turn open/close lifecycle |

### Wave 4 — Validation
| Group | Agent | Description |
|-------|-------|-------------|
| review | reviewer | Review all groups against criteria |
| qa | qa | Full QA pass on dev |

## Execution Groups

### Group 1: provider-framework
**Goal:** Create the provider abstraction layer that all verbs route through.
**Deliverables:**
1. **`packages/api/src/providers/types.ts`** (NEW) — Provider interfaces: `ITtsProvider`, `ISttProvider`, `IImageGenProvider`, `IVideoGenProvider`, `IVisionProvider` with full option types (voice, style, aspect-ratio, size, duration, etc.)
2. **`packages/api/src/providers/registry.ts`** (NEW) — Provider registry: register/get by capability+name, get default from config
3. **`packages/api/src/providers/gemini/client.ts`** (NEW) — Shared `@google/genai` SDK client, model constants
4. **`packages/api/package.json`** — Add `@google/genai` dependency
5. Provider config via settings service: `tts.provider`, `stt.provider`, `imagegen.provider`, `videogen.provider`, `vision.provider`

**Acceptance Criteria:**
- [ ] Provider interfaces compile
- [ ] Registry register/retrieve works
- [ ] Gemini client initializes from env var
- [ ] `bunx tsc --noEmit && bun test` pass

**depends-on:** none

---

### Group 2: context-layer
**Goal:** PG-backed conversation context so verbs know where to send.
**Deliverables:**
1. **DB migration** — Add columns to `api_keys` in `packages/db/src/schema.ts`: `activeInstanceId`, `contextInstanceId`, `contextChatId`, `contextMessageId`, `contextUpdatedAt`. Generate via `bunx drizzle-kit generate` (outputs to `packages/db/drizzle/`).
2. **`packages/api/src/routes/v2/context.ts`** (NEW) — GET/POST/DELETE endpoints for context, scoped to API key
3. **`packages/sdk/src/client.ts`** (MOD) — Add context methods to monolithic SDK client
4. **`packages/cli/src/context.ts`** (NEW) — Resolution chain: explicit flags → env vars → PG context → config defaults → error
5. **CLI commands** (NEW) — `open.ts`, `use.ts`, `where.ts`, `close.ts` in `packages/cli/src/commands/`
6. **`packages/cli/src/index.ts`** — Register new commands

**Acceptance Criteria:**
- [ ] `omni open <name>` resolves contact, stores in PG
- [ ] `omni where` shows stored context
- [ ] `omni use <instance>` sets active instance (scoped to key's allowed instances)
- [ ] Context resolution returns env vars when set, PG when not
- [ ] `bunx tsc --noEmit && bun test` pass

**depends-on:** none

---

### Group 3: instance-scoping
**Goal:** Enforce `api_keys.instanceIds` across ALL routes + auto-provision keys.
**Deliverables:**
1. **Audit + enforce** — Extend `ApiKeyService.instanceAllowed()` to events, automations, webhooks, dead-letters, payloads routes (already in messages + chats)
2. **Auto-key provisioning** — When `PATCH /instances/:id` sets `agentId`: auto-create/update scoped API key named `agent:<name>` with `instanceIds: [instanceId]`
3. Remove instance from key when agent is removed from instance

**Acceptance Criteria:**
- [ ] 403 on unauthorized instance across all routes
- [ ] Agent-instance assignment creates scoped key
- [ ] `bunx tsc --noEmit && bun test` pass

**depends-on:** none

---

### Group 4: persons-and-linking
**Goal:** Expose person merge/link/update via CLI, fix @lid person fragmentation.
**Deliverables:**
1. **`packages/cli/src/commands/persons.ts`** (MOD) — Add `merge`, `link`, `unlink`, `update` subcommands
2. **`packages/sdk/src/client.ts`** (MOD) — Add persons SDK methods (API endpoints already exist and are verified)
3. **`packages/api/src/services/persons.ts`** (MOD) — In `findOrCreateIdentity()`: check `chat_id_mappings` for @lid→phone, link to existing person if found

**Acceptance Criteria:**
- [ ] `omni persons merge <a> <b>` merges persons
- [ ] `omni persons update <id> --phone "+55..."` updates phone
- [ ] New @lid identity with known phone links to existing person
- [ ] `bunx tsc --noEmit && bun test` pass

**depends-on:** none

---

### Group 5: turn-infrastructure
**Goal:** Turn state management, monitoring, and NATS signaling — the backbone of turn-based mode.
**Deliverables:**
1. **`turns` table** — New Drizzle table in `packages/db/src/schema.ts`:
   ```
   turns:
     id            UUID PK
     instanceId    UUID FK → instances
     chatId        TEXT
     messageId     TEXT (trigger message)
     agentId       UUID FK → agents
     apiKeyId      UUID FK → api_keys (scoped key used)
     status        'open' | 'done' | 'timeout'
     action        'message' | 'react' | 'skip' | 'timeout' | null
     nudgeCount    INTEGER default 0
     messagesSent  INTEGER default 0 (during-turn messages tracked)
     startedAt     TIMESTAMP
     lastActivityAt TIMESTAMP
     closedAt      TIMESTAMP nullable
     closedReason  TEXT nullable
     metadata      JSONB nullable
   ```
   Generate migration via `bunx drizzle-kit generate`.

2. **`packages/api/src/services/turns.ts`** (NEW) — Turn service:
   - `open(instanceId, chatId, messageId, agentId, apiKeyId)` → creates turn row
   - `recordActivity(turnId)` → updates `lastActivityAt`
   - `close(turnId, action, reason?)` → sets status, closedAt, action
   - `getOpen(instanceId, chatId)` → returns open turn if any
   - `getStale(inactivityMs)` → returns turns idle longer than threshold
   - `incrementNudge(turnId)` → nudgeCount++
   - `incrementMessages(turnId)` → messagesSent++

3. **`packages/api/src/services/turn-monitor.ts`** (NEW) — Runs on interval (10s):
   - Queries `turns` for open turns with `lastActivityAt` older than thresholds
   - 60s idle → emit `omni.turn.nudge.{instanceId}.{chatId}` via NATS
   - 300s idle → send fallback message to user via existing send infrastructure
   - 900s idle → call `turns.close(id, 'timeout')`, emit `omni.turn.timeout` NATS event

4. **Activity tracking hook** — In auth middleware: when a request comes from a key with an open turn, call `turns.recordActivity()`. This means any `omni say/send/speak/imagine` from the scoped key automatically extends the turn's activity timer. Zero instrumentation needed in verb commands.

5. **NATS event helpers** — Utility to publish `omni.turn.{open,done,nudge,timeout}.{instanceId}.{chatId}` via the existing NATS connection in `NatsGenieProvider` or a shared NATS client.

**Acceptance Criteria:**
- [ ] `turns` table created via migration
- [ ] Turn service opens, records activity, closes, queries stale
- [ ] Turn monitor emits nudge at 60s, timeout at 900s
- [ ] Activity auto-tracked via auth middleware (any API call = activity)
- [ ] NATS events published on turn state changes
- [ ] `bunx tsc --noEmit && bun test` pass

**depends-on:** none

---

### Group 6: core-verbs
**Goal:** `say`, `send` (positional), `react` + `--reply` modifier + shared context resolution.
**Deliverables:**
1. **`packages/cli/src/commands/say.ts`** (NEW) — Text message with context resolution + `--reply`
2. **`packages/cli/src/commands/send.ts`** (MOD) — Add positional arg for file sending (existing flags unchanged)
3. **`packages/cli/src/commands/react.ts`** (NEW) — Emoji reaction to trigger/last message
4. **Shared `--reply` utility** in `packages/cli/src/context.ts` — resolves `--reply [msg-id]` → `OMNI_MESSAGE` → last message → null

**Acceptance Criteria:**
- [ ] `omni say "test"` sends text to open chat
- [ ] `omni say "test" --reply` sends as quote-reply
- [ ] `omni send file.jpg` sends media (positional arg)
- [ ] `omni send --media file.jpg --instance X --to Y` still works
- [ ] `omni react 👍` reacts to trigger message
- [ ] `bunx tsc --noEmit && bun test` pass

**depends-on:** Group 2 (context-layer)

---

### Group 7: done-command
**Goal:** The turn-closing command. Sends final message + emits NATS turn.done event.
**Deliverables:**
1. **`packages/cli/src/commands/done.ts`** (NEW):
   - `omni done "text"` — send text via existing API + call `POST /v2/turns/close` with `action: 'message'`
   - `omni done --media <path> [--caption "text"]` — send media + close
   - `omni done --react <emoji>` — react to `OMNI_MESSAGE` + close
   - `omni done --skip [--reason "text"]` — close with no outbound
   - Uses env var context resolution (same as other verbs)
2. **`packages/api/src/routes/v2/turns.ts`** (NEW):
   - `POST /v2/turns/close` — closes the open turn for this API key's active context, emits NATS `omni.turn.done` event
   - Validates: there IS an open turn for this key + instance + chat
   - Idempotent: closing an already-closed turn returns success
3. **`packages/cli/src/index.ts`** — Register `done` command

**Acceptance Criteria:**
- [ ] `OMNI_INSTANCE=x OMNI_CHAT=y omni done "hello"` sends message + closes turn
- [ ] `omni done --react 👍` reacts to OMNI_MESSAGE + closes turn
- [ ] `omni done --skip` closes turn with no outbound
- [ ] NATS event published to `omni.turn.done.{instanceId}.{chatId}`
- [ ] Double-close is idempotent
- [ ] `bunx tsc --noEmit && bun test` pass

**depends-on:** Group 2 (context-layer), Group 5 (turn-infrastructure)

---

### Group 8: speak-verb
**Goal:** Multi-provider TTS with `omni speak`.
**Deliverables:**
1. **`packages/api/src/providers/gemini/tts.ts`** (NEW) — Gemini TTS (`gemini-2.5-flash-preview-tts`), 30 voices, style prompts
2. **`packages/api/src/providers/elevenlabs/tts.ts`** (NEW) — Adapter wrapping existing `services/tts.ts`
3. **`packages/api/src/routes/v2/media.ts`** (MOD) — Add `POST /v2/media/tts` with provider routing
4. **`packages/cli/src/commands/speak.ts`** (NEW) — `omni speak <text>` with `--voice`, `--provider`, `--style`, `--reply`, `--output`

**Acceptance Criteria:**
- [ ] `omni speak "hello"` sends voice note via default provider
- [ ] `--provider gemini` and `--provider elevenlabs` override
- [ ] `--voice Kore` selects specific voice
- [ ] Existing `omni send --tts` still works
- [ ] `bunx tsc --noEmit && bun test` pass

**depends-on:** Group 1 (provider-framework), Group 2 (context-layer)

---

### Group 9: listen-verb
**Goal:** Multi-provider STT with `omni listen`.
**Deliverables:**
1. **`packages/api/src/providers/gemini/stt.ts`** (NEW) — Gemini STT (`gemini-3-flash-preview`), timestamps, structured output
2. **`packages/api/src/providers/groq/stt.ts`** (NEW) — Groq Whisper (`whisper-large-v3-turbo`), 19.5MB limit
3. **`POST /v2/media/stt`** endpoint with provider routing
4. **`packages/cli/src/commands/listen.ts`** (NEW) — `omni listen <file>` with `--provider`, `--timestamps`, `--format`, `--reply`

**Acceptance Criteria:**
- [ ] `omni listen audio.ogg` prints transcription to stdout
- [ ] `--provider gemini` and `--provider groq` override
- [ ] `--reply` transcribes + sends as quote-reply
- [ ] `bunx tsc --noEmit && bun test` pass

**depends-on:** Group 1, Group 2

---

### Group 10: imagine-verb
**Goal:** Gemini image generation with `omni imagine`.
**Deliverables:**
1. **`packages/api/src/providers/gemini/imagegen.ts`** (NEW) — Nano Banana 2 (`gemini-3.1-flash-image-preview`) via `generateContent` with `responseModalities: ['TEXT', 'IMAGE']`
2. **`POST /v2/media/imagine`** endpoint
3. **`packages/cli/src/commands/imagine.ts`** (NEW) — `omni imagine <prompt>` with `--aspect-ratio`, `--size`, `--model`, `--count`, `--output`, `--reply`

**Acceptance Criteria:**
- [ ] `omni imagine "a cat"` generates and sends to chat
- [ ] `--output cat.png` saves locally
- [ ] `--aspect-ratio 16:9 --model nano-banana-pro` work
- [ ] `bunx tsc --noEmit && bun test` pass

**depends-on:** Group 1, Group 2

---

### Group 11: see-verb
**Goal:** Gemini vision with `omni see`.
**Deliverables:**
1. **`packages/api/src/providers/gemini/vision.ts`** (NEW) — Vision (`gemini-3.1-flash-lite-preview`), guided prompts
2. **`POST /v2/media/vision`** endpoint
3. **`packages/cli/src/commands/see.ts`** (NEW) — `omni see <file> [prompt]` with `--reply`

**Acceptance Criteria:**
- [ ] `omni see photo.jpg` prints description to stdout
- [ ] `omni see photo.jpg "what color?"` uses guided prompt
- [ ] `--reply` describes + quote-replies
- [ ] `bunx tsc --noEmit && bun test` pass

**depends-on:** Group 1, Group 2

---

### Group 12: film-verb
**Goal:** Gemini video generation with `omni film`.
**Deliverables:**
1. **`packages/api/src/providers/gemini/videogen.ts`** (NEW) — Veo 3.1 (`veo-3.1-generate-preview`), async polling
2. **`POST /v2/media/film`** endpoint with async handling
3. **`packages/cli/src/commands/film.ts`** (NEW) — `omni film <prompt>` with `--duration`, `--resolution`, `--reference`, `--extend`, `--output`, `--reply`, progress bar

**Acceptance Criteria:**
- [ ] `omni film "sunset"` generates and sends
- [ ] `--output sunset.mp4` saves locally
- [ ] Progress bar during async generation
- [ ] Timeout after 5 minutes with clear error
- [ ] `bunx tsc --noEmit && bun test` pass

**depends-on:** Group 1, Group 2

---

### Group 13: dispatcher-integration
**Goal:** Wire turn-based mode into the agent dispatcher — the final integration.
**Deliverables:**
1. **`packages/core/src/providers/types.ts`** (MOD) — Add `'turn-based'` to `IAgentProvider.mode` union type
2. **`packages/core/src/providers/nats-genie-provider.ts`** (MOD):
   - Support `mode: 'turn-based'` (configured per provider instance)
   - In `trigger()`: include env vars (`OMNI_API_KEY`, `OMNI_INSTANCE`, `OMNI_CHAT`, `OMNI_MESSAGE`, `OMNI_TURN_ID`) in the NATS message payload under `payload.env`
   - Subscribe to `omni.turn.done.{instanceId}.*` for turn close detection
3. **`packages/api/src/plugins/agent-dispatcher.ts`** (MOD) — When provider mode is `turn-based`:
   - Get or create scoped API key for agent+instance (from Group 3)
   - Open turn via turn service (from Group 5)
   - Inject env vars into the trigger context
   - Track turn after dispatch
4. **`packages/core/src/types/agent.ts`** (MOD) — Add `'turn-based'` to `ProviderSchema` mode options
5. **Schema config** — `schemaConfig.mode: 'turn-based'` on provider setup (e.g., `nats-genie` provider for an instance)

**Acceptance Criteria:**
- [ ] Provider with `mode: 'turn-based'` opens turn on trigger
- [ ] Env vars included in NATS payload for agent bridge
- [ ] Turn closes on `omni.turn.done` NATS event
- [ ] Turn times out at 900s if no activity
- [ ] Agent's API calls auto-extend turn activity
- [ ] `bunx tsc --noEmit && bun test` pass

**depends-on:** Group 3 (instance-scoping), Group 5 (turn-infrastructure)

---

## QA Criteria

_What must be verified on dev after all groups merge._

### Turn Protocol
- [ ] Full turn cycle: message in → agent sends intermediate `omni say` → agent calls `omni done "response"` → user gets both messages → turn closes
- [ ] React turn: message in → `omni done --react ✅` → user sees reaction → turn closes
- [ ] Skip turn: `omni done --skip` → no outbound → turn closes
- [ ] Nudge: agent goes idle 60s → nudge emitted on NATS
- [ ] Timeout: agent idle → nudged → fallback at 300s → force-close at 900s
- [ ] Multi-message: agent sends text + image + voice, then `omni done` → all delivered in order
- [ ] Session isolation: two users same agent → two turns, no interference

### Verbs + Context
- [ ] All 9 commands functional: say, send, speak, react, imagine, film, listen, see, done
- [ ] `--reply` works on say, send, speak, imagine, listen
- [ ] `--provider` override works on speak and listen
- [ ] `omni config set tts.provider` changes default
- [ ] `omni open/use/where/close` lifecycle works

### Infrastructure
- [ ] Scoped API key 403 on all instance-bearing routes
- [ ] `omni persons merge` works
- [ ] `omni send --text "hi" --instance X --to Y` still works (coexistence)
- [ ] `bun test` — 0 failures
- [ ] `bunx tsc --noEmit` — zero type errors
- [ ] `bun run build` — all packages

---

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| 13 groups is large — integration risk | High | Each independently testable. Wave 1 foundation must be solid. Wave 3 is the integration test. |
| Gemini preview models change API surface | Medium | Pin versions, abstract behind provider interfaces |
| Video gen async + expensive | Medium | Rate limiting, progress bar, 5min timeout |
| Turn monitor adds DB polling load | Low | 10s interval, indexed query on (status, lastActivityAt). Negligible vs message throughput. |
| `api_keys.lastUsedAt` update frequency | Low | Already fire-and-forget on every request. No new load. |
| NATS turn events lost (at-most-once) | Low | Turn monitor's timeout is the fallback. If NATS event lost, timeout handles it. |
| Existing integrations break on scoping enforcement | Medium | null instanceIds = all (backwards compat). Audit before enforcing. |
| Person fragmentation makes `omni open` ambiguous | Medium | Persons merge CLI + auto-linking fix root cause |

---

## Review Results

### Plan Review — 2026-04-05

**Verdict: SHIP** ✅

All 7 plan review criteria pass. Codebase claims verified against source. No CRITICAL or HIGH gaps.

**MEDIUM gaps (fixed inline):**
1. `packages/api/src/routes/v2/media.ts` already exists — changed to MOD
2. Wave 1 shared files: `schema.ts` (G2+G5), `auth.ts` (G3+G5), `client.ts` (G2+G4) — engineers must coordinate
3. Drizzle migrations: G2 and G5 generate migrations sequentially, not in parallel
4. Cross-wish overlap: Group 4 @lid auto-linking overlaps with `fix-person-deduplication` — ship person dedup first

**LOW gaps:** Provider interface contracts implied, `omni config set` handled by existing `config.ts` command.

**Coordination:** `fix-person-deduplication` should execute before this wish's Group 4 to avoid conflicts on `persons.ts`.

---

## Files to Create/Modify

```
# Group 1: Provider Framework
packages/api/src/providers/types.ts                    # NEW
packages/api/src/providers/registry.ts                 # NEW
packages/api/src/providers/gemini/client.ts            # NEW
packages/api/package.json                              # MOD

# Group 2: Context Layer
packages/db/drizzle/XXXX_context_on_api_keys.sql       # NEW (generated)
packages/db/src/schema.ts                              # MOD
packages/api/src/routes/v2/context.ts                  # NEW
packages/sdk/src/client.ts                             # MOD
packages/cli/src/context.ts                            # NEW
packages/cli/src/commands/open.ts                      # NEW
packages/cli/src/commands/use.ts                       # NEW
packages/cli/src/commands/where.ts                     # NEW
packages/cli/src/commands/close.ts                     # NEW
packages/cli/src/index.ts                              # MOD

# Group 3: Instance Scoping
packages/api/src/middleware/auth.ts                    # MOD
packages/api/src/routes/v2/instances.ts                # MOD
packages/api/src/routes/v2/events.ts                   # MOD
packages/api/src/routes/v2/automations.ts              # MOD
packages/api/src/routes/v2/webhooks.ts                 # MOD
packages/api/src/routes/v2/dead-letters.ts             # MOD
packages/api/src/routes/v2/payloads.ts                 # MOD

# Group 4: Persons & Linking
packages/cli/src/commands/persons.ts                   # MOD
packages/sdk/src/client.ts                             # MOD
packages/api/src/services/persons.ts                   # MOD

# Group 5: Turn Infrastructure
packages/db/drizzle/XXXX_create_turns_table.sql        # NEW (generated)
packages/db/src/schema.ts                              # MOD
packages/api/src/services/turns.ts                     # NEW
packages/api/src/services/turn-monitor.ts              # NEW
packages/api/src/routes/v2/turns.ts                    # NEW
packages/api/src/middleware/auth.ts                     # MOD (activity tracking)

# Group 6: Core Verbs
packages/cli/src/commands/say.ts                       # NEW
packages/cli/src/commands/send.ts                      # MOD
packages/cli/src/commands/react.ts                     # NEW

# Group 7: Done Command
packages/cli/src/commands/done.ts                      # NEW

# Group 8: speak
packages/api/src/providers/gemini/tts.ts               # NEW
packages/api/src/providers/elevenlabs/tts.ts           # NEW
packages/api/src/routes/v2/media.ts                    # MOD (add TTS/STT/imagine/vision/film endpoints)
packages/cli/src/commands/speak.ts                     # NEW

# Group 9: listen
packages/api/src/providers/gemini/stt.ts               # NEW
packages/api/src/providers/groq/stt.ts                 # NEW
packages/cli/src/commands/listen.ts                    # NEW

# Group 10: imagine
packages/api/src/providers/gemini/imagegen.ts          # NEW
packages/cli/src/commands/imagine.ts                   # NEW

# Group 11: see
packages/api/src/providers/gemini/vision.ts            # NEW
packages/cli/src/commands/see.ts                       # NEW

# Group 12: film
packages/api/src/providers/gemini/videogen.ts          # NEW
packages/cli/src/commands/film.ts                      # NEW

# Group 13: Dispatcher Integration
packages/core/src/providers/types.ts                   # MOD
packages/core/src/providers/nats-genie-provider.ts     # MOD
packages/core/src/types/agent.ts                       # MOD
packages/api/src/plugins/agent-dispatcher.ts           # MOD
```

---

## GitHub Issues
- Closes #259 (native multimodal — expanded to full turn-based execution)
