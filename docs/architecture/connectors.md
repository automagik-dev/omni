# Connectors — integration accounts beside channels

A **connector** is one connected external account (ClickUp today): a provider
manifest, a sealed credential, a typed action catalog and, optionally, inbound
event subscriptions. It is deliberately **not** a channel and **not** an
`instances` row.

## The three surfaces

| You need… | Use… | Why |
| --- | --- | --- |
| To send/receive **messages** on WhatsApp, Slack, Discord, Telegram… | a **channel** (`instances`) | Channels own chats, identities, debounce, agent routing and a reply path. |
| To act on an external **account** and receive its events (ClickUp tasks) | a **connector** | Connectors own a sealed account credential, typed actions and event subscriptions. No chat, no `message.received`, no `send_message`, no debounce, no agent routing. |
| A **credential-less** inbound webhook, a fire-and-forget receiver or a pull source | a **webhook source** (`webhook_sources`) | No account credential and no typed action catalog; the existing liveness contract (#961) supervises it. |

One sentence: **use a webhook source for a credential-less, fire-and-forget or
pull ingress; use a connector when Omni also owns the account credential and
the typed action catalog for that provider.**

A connector never creates an `instances`, `chats` or `messages` row, never emits
`message.received`, and cannot be targeted by `send_message`. Its only outputs
are `connector.event` journal entries and typed actions.

## Model

- `connectors` — provider manifest id, display name, sealed `credentials` JSON,
  non-secret `config`, status (`connected | error | revoked`), validation state,
  tenant ownership.
- `connector_event_subscriptions` — connector → provider event key → one target
  automation, with a **sealed verification secret**, exact-match `filters`,
  status (`active | paused | error`) and delivery counters.
- The journal (`omni_events`) is the delivery log: one `internal`
  `connector.event` row per accepted delivery. There is no delivery table.

A failed connect still persists the row as `error` with a readable
`lastError`/`lastErrorCode`, so the operator fixes the credential with a PATCH.
A provider 401/403 on an action moves the connector to `revoked`. A
subscription becomes `error` after three consecutive processing failures; that
is **advisory** — the next delivery still processes and a success resets it.
Only `paused` stops publication.

## API

All authenticated routes are tenant-scoped, mounted at
`/api/v2/connectors`, with three scopes: `connectors:read`, `connectors:write`
and `connectors:invoke`. Instance-restricted API keys are refused with
`403 CONNECTORS_TENANT_SCOPED` — a tenant-wide credential cannot be narrowed to
an instance.

The only public surface is `POST /api/v2/connectors/events/:subscriptionId`.
It reads the raw body, resolves the subscription, opens the sealed secret and
verifies the provider signature **before** any journal row or publish. Unknown
subscription, unopenable secret and bad signature all return the same `401`.

## Idempotency and replay

Dedupe key: `connector:{subscriptionId}:{providerEventId}`, falling back to
`connector:{subscriptionId}:{sha256(rawBody)}` when the provider sends no stable
event id. The `omni_events.idempotency_key` unique index is the authority: the
journal row is claimed before publish, and a collision is a duplicate (`200`,
no second publish). A failed publish releases the claim so the provider's retry
can claim again (`500`).

At-least-once, not exactly-once. Replay is the existing operator path
(`omni events` / event-ops), which intentionally bypasses ingress dedupe — a
provider redelivery is not a replay.

## ClickUp

See [`docs/runbooks/connectors-clickup.md`](../runbooks/connectors-clickup.md).
