# Runbook — ClickUp as a webhook source

> Issue #984 — RFC #925 Phase 3, source 2 of 2. Walks from a ClickUp webhook
> to a firing automation: one `webhook_sources` row, four registered event
> schemas, one idempotency key template, one declared liveness cadence.
> ClickUp is the recipe's **body-first** proof: unlike GitHub it carries the
> event name and the delivery identity in the JSON body, not in headers —
> which needed two small generic ingress enablers (see
> ["The claim this recipe tests"](#the-claim-this-recipe-tests) for the
> honest config-only verdict).
>
> Pinned end-to-end (fake ClickUp deliveries through the real HTTP ingress
> and a real PostgreSQL journal) by
> `packages/api/src/__tests__/webhook-clickup-source-postgres.test.ts`.

## What you get

Every delivery ClickUp sends to `POST /api/v2/webhooks/ingress/clickup` is:

1. **verified** — HMAC-SHA256 over the raw body against `X-Signature`
   (issue #928; `packages/api/src/services/webhooks.ts`). ClickUp sends the
   bare lowercase hex digest — no `sha256=` prefix — so the source's
   `signatureConfig` simply omits `prefix`;
2. **typed** — the body's `event` field lands as the semantic type:
   `taskStatusUpdated` → `custom.clickup.taskstatusupdated` (the token
   normalizer lowercases event names) via the source's body-sourced
   `eventTypeMapping` (issues #959/#984);
3. **schema-checked** — payloads for the four registered types must satisfy
   their JSON Schema contract or they are dead-lettered, never journaled
   (issue #959);
4. **deduplicated** — ClickUp retries failed deliveries; the
   `clickup:{payload.history_items.0.id}` key template keys every delivery on
   the stable per-event history id, so a retry acks with `duplicate: true`
   and exactly ONE journal event (issue #958);
5. **supervised** — a declared cadence means silence beyond the window emits
   `system.connector.stalled` on the bus instead of failing silently
   (issue #961, see [[../architecture/connector-contract|Connector Lifecycle Contract]]).

## Prerequisites

- An omni API reachable from clickup.com (public URL or tunnel), called
  `https://omni.example.com` below.
- The `omni` CLI configured with an admin API key (`omni config`), or a raw
  API key for the `curl` variants.
- A ClickUp API token (personal token or OAuth) and your Workspace (team) id.
- **No pre-chosen secret**: unlike GitHub, ClickUp *generates* the signing
  secret and returns it when you create the webhook — so the ClickUp webhook
  is created FIRST (step 1) and the omni row second (step 2).

## Step 1 — create the webhook on ClickUp

ClickUp webhooks are API-managed (there is no repo-settings UI form):

```bash
curl -sS -X POST "https://api.clickup.com/api/v2/team/$CLICKUP_TEAM_ID/webhook" \
  -H "Authorization: $CLICKUP_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "endpoint": "https://omni.example.com/api/v2/webhooks/ingress/clickup",
    "events": ["taskStatusUpdated", "taskCreated", "taskUpdated", "taskDeleted"]
  }'
```

The response's `webhook.secret` is the HMAC key ClickUp will sign every
delivery with — capture it:

```bash
export CLICKUP_WEBHOOK_SECRET="<webhook.secret from the response>"
```

(Scope the webhook to a Space/Folder/List by adding `space_id` / `folder_id`
/ `list_id` to the body; `webhook.id` in the response is the `webhook_id`
field you will see in every delivery.)

## Step 2 — create the `webhook_sources` row

One API call declares the whole contract. The public ingress refuses any
source without a `signatureConfig`, so the endpoint is unreachable until this
row exists:

```bash
curl -sS -X POST https://omni.example.com/api/v2/webhook-sources \
  -H "x-api-key: $OMNI_API_KEY" -H 'Content-Type: application/json' \
  -d @- <<JSON
{
  "name": "clickup",
  "description": "ClickUp workspace webhooks (RFC #925 Phase 3 recipe)",
  "signatureConfig": {
    "algorithm": "hmac-sha256",
    "header": "X-Signature"
  },
  "signatureSecret": "$CLICKUP_WEBHOOK_SECRET",
  "idempotencyKeyTemplate": "clickup:{payload.history_items.0.id}",
  "eventTypeMapping": { "source": "body", "path": "event" },
  "expectedIntervalSeconds": 86400
}
JSON
```

Field by field:

| Field | Why |
|---|---|
| `signatureConfig` | ClickUp signs every delivery with `X-Signature: <hex hmac>` — HMAC-SHA256 of the **raw body bytes** under the webhook's generated secret. No prefix (GitHub's `sha256=` has no ClickUp equivalent), so `prefix` is simply omitted. The secret is write-only (never returned by the API). |
| `idempotencyKeyTemplate` | ClickUp does **not** send a top-level delivery id (the RFC's proposed `clickup:{event_id}` referenced a field that does not exist). The stable per-event identity is `history_items[0].id`, reached with a numeric array segment. The template resolves to e.g. `clickup:2800763136717140857`; the unique index on `omni_events.idempotency_key` is the dedup authority. `taskDeleted` carries no `history_items`, so those deliveries fall back to `clickup:{sha256(body)}` — still correct, since a retry resends the same bytes (the fallback logs a warning per delivery; acceptable at taskDeleted volumes). |
| `eventTypeMapping` | Reads the body's `event` field and emits `custom.clickup.{event}` after token normalization (lowercase): `taskStatusUpdated` → `custom.clickup.taskstatusupdated`, `taskCreated` → `custom.clickup.taskcreated`, `taskUpdated` → `custom.clickup.taskupdated`, `taskDeleted` → `custom.clickup.taskdeleted`. Deliveries without a usable `event` field fall back to `custom.webhook.clickup`. |
| `expectedIntervalSeconds` | Declared liveness cadence (#961): "≥1 event **or heartbeat** per 24 h". See step 5. |

CLI alternative:

```bash
omni webhooks create --name clickup \
  --description "ClickUp workspace webhooks" \
  --signature-algorithm hmac-sha256 \
  --signature-header X-Signature \
  --signature-secret-env CLICKUP_WEBHOOK_SECRET \
  --idempotency-key-template 'clickup:{payload.history_items.0.id}' \
  --event-type-mapping '{"source":"body","path":"event"}' \
  --expected-interval 86400
```

The flag also takes `@path/to/mapping.json`, and `omni webhooks update <id>
--event-type-mapping ...` retrofits an existing source
(`--clear-event-type-mapping` removes the mapping). Raw-API fallback for the
same retrofit:

```bash
curl -sS -X PATCH https://omni.example.com/api/v2/webhook-sources/<id> \
  -H "x-api-key: $OMNI_API_KEY" -H 'Content-Type: application/json' \
  -d '{"eventTypeMapping":{"source":"body","path":"event"}}'
```

## Step 3 — register the four event schemas

The JSON Schema artifacts live next to this runbook in
[`docs/examples/event-schemas/clickup/`](../examples/event-schemas/clickup/).
They are minimal-but-real: the fields consumers rely on are required
(`event`, `task_id`, `webhook_id` everywhere; `history_items` with the
per-event id — and before/after status objects for the status change — where
ClickUp sends them) and everything else passes through
(`additionalProperties: true`). Note `taskDeleted` deliberately does NOT
require `history_items` — ClickUp omits it there.

```bash
cd docs/examples/event-schemas/clickup

omni events schema register custom.clickup.taskstatusupdated \
  --file custom.clickup.taskstatusupdated.json --description "ClickUp task status changes"
omni events schema register custom.clickup.taskcreated \
  --file custom.clickup.taskcreated.json --description "ClickUp task creations"
omni events schema register custom.clickup.taskupdated \
  --file custom.clickup.taskupdated.json --description "ClickUp task updates"
omni events schema register custom.clickup.taskdeleted \
  --file custom.clickup.taskdeleted.json --description "ClickUp task deletions"

omni events schema list --enabled
```

From now on a delivery for one of these types that violates its contract is
refused with 400 and dead-lettered (`schema_validation_failed`, visible via
`omni dead-letters list`) — it never enters the journal. Revisions must be
additive-optional; an incompatible change is refused with 409 and must ship
as a new versioned type (e.g. `custom.clickup.taskstatusupdated.v2`).

## Step 4 — verify the ClickUp side

ClickUp has no "recent deliveries" UI; check the webhook's health via the
API:

```bash
curl -sS "https://api.clickup.com/api/v2/team/$CLICKUP_TEAM_ID/webhook" \
  -H "Authorization: $CLICKUP_API_TOKEN" | jq '.webhooks[] | {id, endpoint, health}'
```

`health.status: "active"` with `fail_count: 0` means omni is acking.
ClickUp retries failed deliveries and will mark a persistently failing
webhook `failing`/suspend it — at which point events silently stop, which is
exactly what the liveness cadence (step 5) catches.

No API key appears anywhere on this surface: the ingress route is
auth-exempt and authenticity comes exclusively from the signature. All
rejections (unknown source, disabled, unconfigured, bad signature) collapse
into one 401 shape by design.

## Step 5 — liveness cadence

`expectedIntervalSeconds: 86400` declares "the workspace produces ≥1 event or
heartbeat per day". Quiet workspaces (weekends, holidays) should pair the
declaration with a cheap daily heartbeat from any cron box:

```bash
# crontab: 17 6 * * *
omni webhooks heartbeat clickup
# or: curl -fsS -X POST "$OMNI_URL/api/v2/webhooks/clickup/heartbeat" -H "x-api-key: $OMNI_API_KEY"
```

Heartbeats create NO journal events — only the `system.connector.stalled` /
`system.connector.recovered` **transitions** are journaled, once each
(never as dead-letter entries — a stall is an alert, #1063). Health is visible in
`omni webhooks list` / `omni webhooks get clickup` (`livenessStatus`). A
stall is also your early warning that ClickUp auto-suspended the webhook
(step 4).

## Step 6 — a firing automation

Automations trigger on the exact semantic type. The RFC's motivating case —
"card status changes → replaces pollers":

```bash
omni automations create \
  --name "ClickUp status change notifier" \
  --trigger custom.clickup.taskstatusupdated \
  --action send_message \
  --action-config '{
    "instanceId": "<instance uuid>",
    "chatId": "<chat id>",
    "message": "task {{payload.task_id}}: {{payload.history_items.0.before.status}} → {{payload.history_items.0.after.status}} (by {{payload.history_items.0.user.username}})"
  }'
```

To hand the whole delivery to an agent instead of picking fields, use the
`{{payload_json}}` / `{{event_json}}` placeholders (compact JSON), and repeat
`--action` for an ordered multi-action automation:

```bash
omni automations create \
  --name "ClickUp status change → agent" \
  --trigger custom.clickup.taskstatusupdated \
  --action log --action-config '{"message":"clickup {{payload.task_id}}"}' \
  --action call_agent --agent-id <agent id> \
  --action-config '{"promptOverride":"A ClickUp task changed status. Event: {{event_json}}"}'

# Dry-run against a real delivery before enabling (verdicts, no side effects):
omni automations test <automation id> --event <event id>
```

Because retry dedup happens **before** publish, a ClickUp retry can never
double-fire this automation: one delivery = one journal event = at most one
firing.

Route the liveness transitions the same way (`--trigger
system.connector.stalled` + a `webhook`/`send_message` action) to be paged
when the source goes quiet.

## Step 7 — verify end to end

```bash
# Drag a card to another status in ClickUp; then:
omni events list --type 'custom.clickup.*'
omni events trace <eventId>              # roots at the ingress claim row

# Retry drill: temporarily 500 the endpoint (or replay the same delivery
# bytes + signature). Expect HTTP 200 with {"duplicate": true} and NO new
# journal event:
omni webhooks get clickup                # totalReceived vs totalDuplicates
```

## Troubleshooting

| Symptom | Cause |
|---|---|
| Every delivery 401 | Secret mismatch — the omni row must hold the `webhook.secret` ClickUp returned at creation (recreate the ClickUp webhook = new secret), or the source has no `signatureConfig`, or it is disabled. All collapse into the same 401 intentionally; the real reason is in the API log (`Webhook ingress rejected`). |
| Delivery 400 `VALIDATION` | The payload violates a registered schema — check `omni dead-letters list` for `schema_validation_failed`. |
| Events land as `custom.webhook.clickup` | `eventTypeMapping` missing on the source row — retrofit it with `omni webhooks update clickup --event-type-mapping '{"source":"body","path":"event"}'` — or the delivery had no usable `event` field. |
| Duplicate events on retry | `idempotencyKeyTemplate` not set to `clickup:{payload.history_items.0.id}` (check `omni webhooks get clickup`). |
| Warn log "idempotency template placeholder unresolved" | Expected for `taskDeleted` (no `history_items`): the key falls back to the body hash, which still dedups byte-identical retries. |
| Events stop arriving entirely | ClickUp auto-suspends persistently failing webhooks — check `health.status` (step 4). The liveness stall (#961) is the designed alarm for this. |
| `system.connector.stalled` during a quiet week | Expected: that is the declared contract doing its job. Heartbeat (step 5) to distinguish quiet from dead, or lengthen/clear the cadence. |

## The claim this recipe tests

RFC #925: *"each source = 1 webhook source row + N registered schemas + a key
template, zero new ingress code."* For this second source the verdict is
**config-only with two recorded gaps** (issue #984): the pre-existing ingress
could not express a **body-first** provider, so two minimal generic enablers
shipped alongside this runbook —

1. `eventTypeMapping` gained a `{ "source": "body", "path": "..." }` variant
   (it was header-only; ClickUp's event name lives in the body);
2. the idempotency payload-path grammar gained numeric array indexing
   (ClickUp's stable event id lives at `history_items.0.id`; the RFC's
   proposed `{event_id}` field does not exist in real ClickUp payloads).

Signature verification (#928, including no-prefix hex digests), the schema
gate (#959), redelivery dedup (#958) and liveness supervision (#961) all
executed unmodified. Everything in THIS runbook is configuration; the
end-to-end proof is
`packages/api/src/__tests__/webhook-clickup-source-postgres.test.ts`.
