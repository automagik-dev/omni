# Gupshup channel plugin — operator runbook

Alerts and diagnostics for the `@omni/channel-gupshup` webhook ingestion path.

## Alerts

### `gupshup.webhook.received{handled=dropped_unknown_fail_open} > 0/min`

**What it means.** Gupshup is sending us an `event_type` value that is not in
`KNOWN_MESSAGE_EVENT_TYPES` (currently `user_input`, `async_response`,
`click_to_chat_advertise`) and not in `KNOWN_NON_MESSAGE_EVENT_TYPES` either.
The handler fails open and still processes the payload, so no messages are lost
— but the allowlist is drifting from what Gupshup actually sends.

**Why it matters.** This is the exact drift signal that would have fired at
webhook #1 on 2026-04-22 when Gupshup flipped `user_input` → `async_response`
(see incident #503). We want this to be a loud, early alert rather than a
silent production outage four hours later.

**What to do.**

1. Filter logs for the first-seen WARN: `grep "first time seeing this event_type"`
   in `~/.omni/logs/omni-api-out.log`. The WARN payload includes the new
   `event_type` value.
2. Pull a sample webhook body from a raw `"[gupshup] raw webhook received"`
   INFO log for the same instance in the same window.
3. Confirm the new `event_type` represents a user message (has `messageobj.id`,
   `messageobj.type`, `messageobj.from`, `messageobj.timestamp`).
4. Add the new value to `KNOWN_MESSAGE_EVENT_TYPES` in
   `packages/channel-gupshup/src/handlers/webhooks.ts` and add a fixture under
   `packages/channel-gupshup/src/__tests__/fixtures/` derived from the captured
   body (PII scrubbed). Ship a PR with the test.

### `gupshup.webhook.received{handled=dropped_unrecognized_shape} > 0/min`

**What it means.** Schema validation failed on the parsed body, or the body
could not be parsed at all.

**What to do.** Log search `"webhook payload unrecognized shape"` and inspect
the `errors` field — tells you which Zod assertion failed. Usually Gupshup
changed a field shape (number ↔ string) or introduced a required nested
structure.

## Dashboards

Counter dimensions: `{ instanceId, event_type, handled }`.

Handled enum:

| `handled` | Meaning |
|-----------|---------|
| `processed` | Known message event_type, dispatched to `processInboundMessage` successfully. |
| `dropped_known_non_message` | Explicit denylist hit (status/billing receipts). Healthy. |
| `dropped_unknown_fail_open` | Unknown `event_type` — processed anyway, format drift alert. |
| `dropped_unrecognized_shape` | Schema validation failure (body malformed). |
| `dropped_empty_content` | `extractContent()` returned null or dedupe suppressed a retry. |

A healthy instance shows almost all traffic under `processed` +
`dropped_known_non_message`. Any sustained volume under `dropped_unknown_fail_open`
or `dropped_unrecognized_shape` is an incident.

## Handoff options

Per-instance, stored in `instances.gupshup_handoff_options` (jsonb) and validated
on connect — a malformed object fails the connect with the offending path in the
error, it never surfaces as a broken handoff later.

```json
{
  "defaultFields": { "queue": "SALES" },
  "fieldsByPhonePrefix": [
    { "prefixes": ["5511", "5521"], "fields": { "queue": "SALES-SOUTHEAST" } }
  ],
  "customerFields": [
    { "apiKey": "Queue", "from": "queue" },
    { "apiKey": "Handled By", "value": "assistant" },
    { "apiKey": "Full Name", "from": "name" }
  ]
}
```

- `defaultFields` / `fieldsByPhonePrefix` — routing fields merged **under** whatever the
  emitter sent. Explicit fields always win; an empty or `"undefined"`/`"null"` value from the
  emitter counts as not sent. This is what keeps a system-initiated handoff (agent dispatch
  error, silence watchdog) inside a queue: those paths never carry `handoff_fields`.
- `customerFields` — ordered template for the Custom Integration `customerFields` array.
  Entries whose source resolves empty are dropped. The `apiKey` set is whatever your Journey
  reads; the channel does not assume any.

Set it at creation with `omni instances create ... --gupshup-handoff-options '<json>'`, later
with `omni instances update <id> --gupshup-handoff-options '<json>'` (`'null'` clears it), or
through `POST /api/v2/instances` / `PATCH /api/v2/instances/:id` (`"gupshupHandoffOptions": null`
clears it) and the dashboard's instance Config tab. Instances without the column set behave
exactly as before.

A `PATCH` or Config-tab save only persists the row. The plugin reads the options once, at
connect, so a running instance keeps the template it connected with until it is restarted:
`omni instances restart <id>` or `POST /api/v2/instances/:id/restart`. The API rejects a bad
shape with a 400 before it is stored; anything that still reaches the plugin fails that
connect/restart with the offending path, and the instance stays down until it is corrected.

## Interactive messages and WhatsApp Flows

The Custom Integration has no native interactive shape, so buttons, lists and
WhatsApp Flows go out as their own `msg_type` events on the same callback URL.
**The partner Journey must branch on `msg_type`** and map each one to the
matching Bot Studio node — a Journey that only knows TEXT/HANDOFF/CLOSING will
not deliver them.

| Omni input | `msg_type` | Bot Studio node | Limits (enforced here) |
|---|---|---|---|
| `POST /messages/send` with `buttons` (≤3) | `BUTTONS` | Reply | ≤3 buttons, title ≤20 chars |
| `POST /messages/send` with `buttons` (4–10) or `list` | `LIST` | List | ≤10 rows, row title ≤24, description ≤72 |
| `POST /instances/:id/whatsapp-flows/send` | `FLOW` | WhatsApp Flow | open session only (Meta) |

Outbound payloads (common fields — `customer_id`, `user.phone`, `event_id`,
`event_time`, `message_text` — as for TEXT):

```json
{ "msg_type": "BUTTONS", "message_text": "Question?",
  "buttons": [ { "id": "yes", "title": "Yes" }, { "id": "no", "title": "No" } ] }

{ "msg_type": "LIST", "message_text": "Pick one",
  "list": { "button": "See options", "section_title": "Options",
            "rows": [ { "id": "a", "title": "A", "description": "…" } ] } }

{ "msg_type": "FLOW", "message_text": "Fill in the form 👇",
  "flow": { "id": "<meta flow id>", "cta": "Fill in", "token": "omni.<ref>.<uuid>",
            "action": "navigate", "screen": "FIRST_SCREEN", "data": { … },
            "header": "…", "footer": "…", "draft": false } }
```

URL buttons cannot be expressed through the Journey: they are folded into
`message_text` as `label: url` lines. A flow must be addressed by `id` (the
WhatsApp Flow node has no lookup by name). `screen`/`data` are sent only for
`navigate` flows; `data_exchange` flows get their first screen from the
endpoint.

### Replies

- **Button / list tap** — arrives as an ordinary inbound message (the option
  title) on the regular webhook. Nothing to configure beyond the Journey
  forwarding the reply the way it forwards text.
- **Flow submission** — Gupshup lands it on the *WhatsApp Flow Journey* (one
  per flow id), not on the regular path. That Journey's **API node** must POST
  to this instance's webhook (`/api/v2/channels/gupshup/{instanceId}/webhook`,
  same token as regular traffic):

```json
{ "event_type": "flow_response",
  "sender": { "id": "<phone, digits>", "name": "<optional>" },
  "flow": { "token": "<flow_token from the response>", "id": "<flow id>",
            "response": { "<field>": "<value>", … } },
  "timestamp": 1790000000 }
```

`flow.response` may be the Bot Studio JSON variable as an object or as a
serialized string. It becomes a text inbound — `[Form submitted]` followed
by one `field: value` line per answer — with the structured answers in
`rawPayload.messageobj.raw.flowResponse` (`flowToken`, `flowId`, `answers`).
Name the Flow JSON components after what they hold (`city`, `ages`, …): the
keys are what the agent reads. A retry of the same submission is deduplicated
by (token, answers).
