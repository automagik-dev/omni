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

Set it with `omni instances update <id> --gupshup-handoff-options '<json>'` or through
`PATCH /api/v2/instances/:id`. Instances without the column set behave exactly as before.
