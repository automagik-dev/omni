# Runbook — GitHub as a webhook source

> Issue #983 — RFC #925 Phase 3, source 1 of 2. Walks from GitHub repo webhook
> settings to a firing automation using ONLY configuration: one
> `webhook_sources` row, four registered event schemas, one idempotency key
> template, one declared liveness cadence. **Zero new ingress code.**
>
> Pinned end-to-end (fake GitHub deliveries through the real HTTP ingress and
> a real PostgreSQL journal) by
> `packages/api/src/__tests__/webhook-github-source-postgres.test.ts`.

## What you get

Every delivery GitHub sends to `POST /api/v2/webhooks/ingress/github` is:

1. **verified** — HMAC-SHA256 over the raw body against `X-Hub-Signature-256`
   (issue #928; `packages/api/src/services/webhooks.ts`);
2. **typed** — `X-GitHub-Event: push` lands as `custom.github.push` (not the
   collapsed `custom.webhook.github`) via the source's `eventTypeMapping`
   (issue #959);
3. **schema-checked** — payloads for the four registered types must satisfy
   their JSON Schema contract or they are dead-lettered, never journaled
   (issue #959);
4. **deduplicated** — GitHub redelivers on any non-2xx/timeout and offers a
   manual "Redeliver" button; the `github:{headers.x-github-delivery}` key
   template makes every redelivery ack with `duplicate: true` and exactly ONE
   journal event (issue #958);
5. **supervised** — a declared cadence means silence beyond the window emits
   `system.connector.stalled` + a DLQ entry instead of failing silently
   (issue #961, see [[../architecture/connector-contract|Connector Lifecycle Contract]]).

## Prerequisites

- An omni API reachable from github.com (public URL or tunnel), called
  `https://omni.example.com` below.
- The `omni` CLI configured with an admin API key (`omni config`), or a raw
  API key for the `curl` variants.
- A webhook secret: `openssl rand -hex 32` — you will paste the same value
  into omni (step 1) and GitHub (step 3).

## Step 1 — create the `webhook_sources` row

One API call declares the whole contract. The public ingress refuses any
source without a `signatureConfig`, so the endpoint is unreachable until this
row exists:

```bash
export GITHUB_WEBHOOK_SECRET="<output of openssl rand -hex 32>"

curl -sS -X POST https://omni.example.com/api/v2/webhook-sources \
  -H "x-api-key: $OMNI_API_KEY" -H 'Content-Type: application/json' \
  -d @- <<JSON
{
  "name": "github",
  "description": "GitHub repo webhooks (RFC #925 Phase 3 recipe)",
  "signatureConfig": {
    "algorithm": "hmac-sha256",
    "header": "X-Hub-Signature-256",
    "prefix": "sha256="
  },
  "signatureSecret": "$GITHUB_WEBHOOK_SECRET",
  "idempotencyKeyTemplate": "github:{headers.x-github-delivery}",
  "eventTypeMapping": { "source": "header", "header": "X-GitHub-Event" },
  "expectedIntervalSeconds": 86400
}
JSON
```

Field by field:

| Field | Why |
|---|---|
| `signatureConfig` | GitHub signs every delivery with `X-Hub-Signature-256: sha256=<hex hmac>` — HMAC-SHA256 of the **raw body bytes** under the shared secret. Omni verifies over the raw body before anything is published; the secret is write-only (never returned by the API). |
| `idempotencyKeyTemplate` | `X-GitHub-Delivery` is GitHub's per-delivery GUID and is **stable across redeliveries**. The template resolves to e.g. `github:72d3162e-cc78-11e3-81ab-4c9367dc0958`; the unique index on `omni_events.idempotency_key` is the dedup authority. Note the header placeholder is lowercase: `{headers.x-github-delivery}`. If the header were ever missing, derivation falls back to `github:{sha256(body)}`. |
| `eventTypeMapping` | Reads `X-GitHub-Event` and emits `custom.github.{event}`: `push` → `custom.github.push`, `pull_request` → `custom.github.pull_request`, `issues` → `custom.github.issues`, `release` → `custom.github.release`. Deliveries without the header fall back to `custom.webhook.github`. |
| `expectedIntervalSeconds` | Declared liveness cadence (#961): "≥1 event **or heartbeat** per 24 h". See step 4. |

CLI alternative:

```bash
omni webhooks create --name github \
  --description "GitHub repo webhooks" \
  --signature-algorithm hmac-sha256 \
  --signature-header X-Hub-Signature-256 \
  --signature-prefix sha256= \
  --signature-secret-env GITHUB_WEBHOOK_SECRET \
  --idempotency-key-template 'github:{headers.x-github-delivery}' \
  --event-type-mapping '{"source":"header","header":"X-GitHub-Event"}' \
  --expected-interval 86400
```

The flag also takes `@path/to/mapping.json`, and `omni webhooks update <id>
--event-type-mapping ...` retrofits an existing source
(`--clear-event-type-mapping` removes the mapping). Raw-API fallback for the
same retrofit:

```bash
curl -sS -X PATCH https://omni.example.com/api/v2/webhook-sources/<id> \
  -H "x-api-key: $OMNI_API_KEY" -H 'Content-Type: application/json' \
  -d '{"eventTypeMapping":{"source":"header","header":"X-GitHub-Event"}}'
```

## Step 2 — register the four event schemas

The JSON Schema artifacts live next to this runbook in
[`docs/examples/event-schemas/github/`](../examples/event-schemas/github/).
They are minimal-but-real: the fields consumers rely on are required
(`repository.full_name`, `sender.login`; `ref`/`commits` for push,
`action`+`number` for PR, `action`+`issue.number` for issues,
`release.tag_name` for releases) and everything else GitHub sends passes
through (`additionalProperties: true`).

```bash
cd docs/examples/event-schemas/github

omni events schema register custom.github.push \
  --file custom.github.push.json --description "GitHub push deliveries"
omni events schema register custom.github.pull_request \
  --file custom.github.pull_request.json --description "GitHub pull_request deliveries"
omni events schema register custom.github.issues \
  --file custom.github.issues.json --description "GitHub issues deliveries"
omni events schema register custom.github.release \
  --file custom.github.release.json --description "GitHub release deliveries"

omni events schema list --enabled
```

From now on a delivery for one of these types that violates its contract is
refused with 400 and dead-lettered (`schema_validation_failed`, visible via
`omni dead-letters list`) — it never enters the journal. Revisions must be
additive-optional; an incompatible change is refused with 409 and must ship as
a new versioned type (e.g. `custom.github.push.v2`).

## Step 3 — configure the webhook on GitHub

Repo → **Settings → Webhooks → Add webhook** (org-level works the same):

| GitHub field | Value |
|---|---|
| Payload URL | `https://omni.example.com/api/v2/webhooks/ingress/github` |
| Content type | **`application/json`** — required. The ingress rejects form-encoded bodies (400), and the HMAC is over the raw JSON bytes. |
| Secret | the same `$GITHUB_WEBHOOK_SECRET` from step 1 |
| SSL verification | enabled |
| Events | "Let me select individual events" → **Pushes**, **Pull requests**, **Issues**, **Releases** |

Save. GitHub immediately sends a `ping` delivery — it carries
`X-GitHub-Event: ping`, so it lands as `custom.github.ping` (unregistered
type → passes the schema gate untouched). A 200 under "Recent Deliveries"
proves the signature contract is right.

No API key appears anywhere on this surface: the ingress route is
auth-exempt and authenticity comes exclusively from the signature. All
rejections (unknown source, disabled, unconfigured, bad signature) collapse
into one 401 shape by design.

## Step 4 — liveness cadence

`expectedIntervalSeconds: 86400` declares "GitHub produces ≥1 event or
heartbeat per day". Real repos are quiet on weekends, so pair the declaration
with a cheap daily heartbeat — a scheduled GitHub Actions workflow is the
natural home (it also proves the repo→omni path end to end):

```yaml
# .github/workflows/omni-heartbeat.yml
name: omni-heartbeat
on:
  schedule:
    - cron: '17 6 * * *'
jobs:
  heartbeat:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsS -X POST "$OMNI_URL/api/v2/webhooks/github/heartbeat" \
            -H "x-api-key: ${{ secrets.OMNI_API_KEY }}"
        env:
          OMNI_URL: https://omni.example.com
```

(`omni webhooks heartbeat github` does the same from a cron box.) Heartbeats
create NO journal events — only the `system.connector.stalled` /
`system.connector.recovered` **transitions** are journaled, once each, and a
stall also files a manual-resolution dead-letter entry. Health is visible in
`omni webhooks list` / `omni webhooks get github` (`livenessStatus`).

## Step 5 — a firing automation

Automations trigger on the exact semantic type. Example: announce merged
pushes in a chat:

```bash
omni automations create \
  --name "GitHub push notifier" \
  --trigger custom.github.push \
  --action send_message \
  --config '{
    "instanceId": "<instance uuid>",
    "chatId": "<chat id>",
    "message": "push to {{payload.repository.full_name}} ({{payload.ref}}) by {{payload.sender.login}}"
  }'
```

Because redelivery dedup happens **before** publish, a GitHub redelivery can
never double-fire this automation: one delivery = one journal event = at most
one firing.

Route the liveness transitions the same way (`--trigger
system.connector.stalled` + a `webhook`/`send_message` action) to be paged
when the source goes quiet.

## Step 6 — verify

```bash
# Push a commit, open/close a PR, publish a release; then:
omni events list --type 'custom.github.*'
omni events trace <eventId>              # roots at the ingress claim row

# Redelivery drill: GitHub → Settings → Webhooks → Recent Deliveries →
# "Redeliver" on any delivery. Expect HTTP 200 with {"duplicate": true} and
# NO new event in the journal:
omni webhooks get github                 # totalReceived vs totalDuplicates
```

## Troubleshooting

| Symptom | Cause |
|---|---|
| Every delivery 401 | Secret mismatch (omni row vs GitHub settings), or the source has no `signatureConfig`, or it is disabled. All collapse into the same 401 intentionally; the real reason is in the API log (`Webhook ingress rejected`). |
| Delivery 400 `VALIDATION` | Content type is form-encoded (must be `application/json`), or the payload violates a registered schema — check `omni dead-letters list` for `schema_validation_failed`. |
| Events land as `custom.webhook.github` | `eventTypeMapping` missing on the source row — retrofit it with `omni webhooks update github --event-type-mapping '{"source":"header","header":"X-GitHub-Event"}'`. |
| Duplicate events on redelivery | `idempotencyKeyTemplate` not set to `github:{headers.x-github-delivery}` (check `omni webhooks get github`). |
| `system.connector.stalled` during a quiet week | Expected: that is the declared contract doing its job. Heartbeat (step 4) to distinguish quiet from dead, or lengthen/clear the cadence. |

## The claim this recipe proves

RFC #925: *"each source = 1 webhook source row + N registered schemas + a key
template, zero new ingress code."* This runbook is pure configuration —
signature verification, semantic typing, schema gating, redelivery dedup and
liveness supervision all execute on the pre-existing ingress
(`packages/api/src/services/webhooks.ts`, untouched by #983). The
end-to-end proof is
`packages/api/src/__tests__/webhook-github-source-postgres.test.ts`.
