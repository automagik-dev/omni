---
slug: gupshup-channel-rewrite
title: "Rewrite channel-gupshup: Meta-format inbound + Custom Integration outbound"
status: DRAFT
priority: P1
---

## Summary

The existing `packages/channel-gupshup` targets the wrong API — it was built for the Gupshup Partner API (old format) and is effectively a placeholder. A proof-of-concept (`teste-webhook-gupshup/server.js`) confirmed end-to-end working integration on 2026-04-10/13 using Meta/WA Business API inbound format and Gupshup Custom Integration outbound. This wish rewrites the plugin to match what actually works in production.

---

## Scope

**IN:**
- Full rewrite of all files in `packages/channel-gupshup/src/`
- Inbound: parse Meta/WA Business API format for all 10 message types (text, image, audio, video, document, sticker, location, contacts, interactive, button)
- Inbound: status events → omni events (delivered → `message.delivered`, read → `message.read`, failed → `message.failed`)
- Outbound: 7 types via Custom Integration (TEXT, IMAGE, AUDIO, VIDEO, DOCUMENT, STICKER, LOCATION)
- Connect-time credential validation via POST test (403 → AUTH_FAILED)
- Brazilian mobile phone normalization (`5551997285829` → `555197285829`)
- Rewrite test suite with real Meta-format payload fixtures

**OUT:**
- Outbound interactive buttons (not supported by Custom Integration)
- Outbound contacts (not supported by Custom Integration)
- Typing indicators (stateless REST — no socket)
- Gupshup Partner API / `mediaapi.smsgupshup.com` (not used)
- `billing-event` / `account_update` processing (silently return 200)
- Template message sending (handled by Gupshup ipaas flow, not the plugin)

---

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Full in-place rewrite | Current code is a placeholder, not partial work worth preserving |
| Inbound format | Meta/WA Business API | Confirmed from live webhook DB (2,500+ real payloads) |
| Outbound | Custom Integration callback URL | Confirmed working end-to-end; no Partner API credentials needed |
| Config shape | Minimal + defaults | `callbackUrl` + `authToken` required; `eventId` defaults to `nx_omni_agent_reply` |
| Credential validation | POST test at connect | 403 = bad auth (confirmed); clean HTTP status, no body parsing needed |
| `canSendButtons` | false | Custom Integration doesn't support interactive buttons |
| `canSendContact` | false | Custom Integration doesn't support contact cards |
| `canSendLocation` | true | Confirmed working: `msg_type: LOCATION` + lat/lng fields |
| `canSendSticker` | true | Confirmed working: `msg_type: STICKER` + `media_url` |

---

## Instance Config

```typescript
interface GupshupConfig {
  gupshupCallbackUrl: string;     // required
  gupshupAuthToken: string;       // required
  gupshupEventId?: string;        // optional, default: "nx_omni_agent_reply"
  webhookVerifyToken?: string;    // optional, skip token check if not set
}
```

---

## Outbound Payload Shapes

Base (all types):
```json
{ "customer_id": "<phone>", "user": { "phone": "<phone>" }, "event_id": "...", "event_time": "<ISO>", "msg_type": "...", "message_text": "" }
```

Type extensions:
- `TEXT` → `+ message_text`
- `IMAGE` → `+ media_url, caption?`
- `AUDIO` → `+ media_url`
- `VIDEO` → `+ media_url, caption?`
- `DOCUMENT` → `+ media_url, caption?, filename?`
- `STICKER` → `+ media_url`
- `LOCATION` → `+ latitude, longitude, name?, address?, message_text?`

---

## Success Criteria

- [ ] All 10 inbound message types parsed and emitted as `message.received` with correct content
- [ ] `delivered`, `read`, `failed` status events emit correct omni events
- [ ] Outbound TEXT, IMAGE, AUDIO, VIDEO, DOCUMENT, STICKER, LOCATION POST to Custom Integration correctly
- [ ] Bad auth token at connect → throws `GupshupError(AUTH_FAILED)` (HTTP 403 confirmed)
- [ ] Good credentials → instance state = `connected`
- [ ] BR mobile phone normalization correct on all outbound sends
- [ ] `make typecheck` passes clean
- [ ] `make lint` passes clean (biome, no warnings)
- [ ] `bun test packages/channel-gupshup` passes with rewritten fixtures

---

## Execution Groups

### Group 1 — Types + Config
**Goal:** Replace all type definitions with Meta-format inbound types and new config shape.

**Deliverables:**
- `src/types.ts` — new `GupshupConfig`, Meta-format inbound payload interfaces (all 10 msg types + status events)
- `src/capabilities.ts` — updated per decisions above

**Acceptance criteria:**
- TypeScript compiles with no errors
- All downstream files that import from `types.ts` updated accordingly

**Validation:**
```bash
cd packages/channel-gupshup && bunx tsc --noEmit
```

---

### Group 2 — Inbound Webhook Handler
**Goal:** Rewrite webhook parser to handle Meta/WA Business API format for all message and status types.

**Deliverables:**
- `src/handlers/webhooks.ts` — full rewrite:
  - Parse `entry[0].changes[0].value.messages[]` for inbound messages
  - Parse `entry[0].changes[0].value.statuses[]` for status events
  - Route all 10 msg types to `handleMessageReceived`
  - Route `delivered`/`read` to existing handlers, `failed` to `handleMessageFailed`
  - Ignore `billing-event`, `account_update`, `enqueued`, `sent`
  - Optional token check via `?token=` query param (skip if `webhookVerifyToken` not configured)
  - Zod schema for top-level payload validation

**Acceptance criteria:**
- Each of the 10 message types produces a `message.received` event with correct content fields
- `failed` status produces `message.failed`
- `billing-event` returns 200 with no processing
- Bad token returns 401

**Validation:**
```bash
bun test packages/channel-gupshup/src/__tests__/webhooks.test.ts
```

---

### Group 3 — Outbound Client + Senders
**Goal:** Replace Partner API client with Custom Integration sender; implement all 7 outbound types.

**Deliverables:**
- `src/client.ts` — new `GupshupClient`: posts to `gupshupCallbackUrl` with `gupshupAuthToken`; `validateCredentials()` does POST test (403 → false)
- `src/utils/identity.ts` — update `normalizePhone` to strip BR extra-9 for outbound
- `src/senders/text.ts` — rewrite for Custom Integration
- `src/senders/media.ts` — rewrite; handles IMAGE, AUDIO, VIDEO, DOCUMENT, STICKER
- `src/senders/location.ts` — new; handles LOCATION with lat/lng/name/address
- Delete `src/senders/template.ts` and `src/senders/interactive.ts`

**Acceptance criteria:**
- Each sender produces the correct JSON payload shape (verified against confirmed spec)
- Bad auth token → `validateCredentials()` returns false
- BR number `5551997285829` normalizes to `555197285829`
- Non-BR number passes through unchanged

**Validation:**
```bash
bun test packages/channel-gupshup/src/__tests__/senders.test.ts
bun test packages/channel-gupshup/src/__tests__/client.test.ts
bun test packages/channel-gupshup/src/__tests__/identity.test.ts
```

---

### Group 4 — Plugin Wiring
**Goal:** Update `plugin.ts` to use new client, new config shape, new capabilities, and new webhook handler.

**Deliverables:**
- `src/plugin.ts` — update `connect()`, `disconnect()`, `sendMessage()` dispatch, `handleWebhook()`, capabilities reference
- `src/index.ts` — update exports (remove template/interactive, add location sender)

**Acceptance criteria:**
- `connect()` with bad credentials throws `GupshupError(AUTH_FAILED)`
- `sendMessage()` routes all 7 outbound types correctly
- `handleWebhook()` delegates to rewritten handler
- Full plugin compiles and passes typecheck

**Validation:**
```bash
cd packages/channel-gupshup && bunx tsc --noEmit
bun test packages/channel-gupshup/src/__tests__/capabilities.test.ts
```

---

### Group 5 — Test Suite Rewrite
**Goal:** Replace all test fixtures with real Meta-format payloads captured from the live webhook DB.

**Deliverables:**
- `src/__tests__/webhooks.test.ts` — fixtures for all 10 inbound types + status events
- `src/__tests__/senders.test.ts` — payload shape assertions for all 7 outbound types
- `src/__tests__/client.test.ts` — auth validation tests
- `src/__tests__/identity.test.ts` — normalization edge cases
- `src/__tests__/capabilities.test.ts` — update expectations

**Acceptance criteria:**
- `bun test packages/channel-gupshup` — all tests pass, no skips
- Coverage includes all 10 inbound types and all status events

**Validation:**
```bash
bun test packages/channel-gupshup --reporter verbose
```

---

### Group 6 — Quality Gate
**Goal:** Full quality checks pass before merge.

**Deliverables:**
- Clean typecheck, lint, knip, tests across the whole repo

**Validation:**
```bash
make typecheck
make lint
bunx knip
bun test packages/channel-gupshup
```

---

## Assumptions & Risks

- **Custom Integration payload spec is final** — confirmed from live testing; if Gupshup changes the schema, senders break
- **Credential test POST** — confirmed 403 on bad auth; good auth response not tested exhaustively (may return 200 or 4xx depending on payload validity)
- **Non-BR phone normalization** — regex only affects `^55\d{2}9\d{8}$`; international numbers pass through unchanged (correct behavior)
- **`webhookVerifyToken` optional** — open webhook if not configured; operators should set this in production
- **No `location` / `contacts` outbound** — documented limitation; users sending these inbound get routed to agent as text representation

---

## References

- Design: `.genie/brainstorms/gupshup-channel-rewrite/DESIGN.md`
- POC: `/home/cezar/dev/teste-webhook-gupshup/server.js`
- Integration doc: `/home/cezar/dev/omni/docs/GUPSHUP_INTEGRATION.md`
- Live webhook DB: `postgresql://postgres:postgres@127.0.0.1:9432/webhooks` (2,500+ real payloads)
