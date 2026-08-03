# channel-hermes — Patterns

> Package-local conventions for the Hermes (Mutant, mutant.com.br) WhatsApp gateway plugin.
> For the broader Omni architecture see `../../AGENTS.md` and `../../.claude/CLAUDE.md`.

## What this package owns

- Outbound REST calls to a per-customer Hermes deployment (`{hermesBaseUrl}/api/v2/...`).
- JWT auth lifecycle: `POST /api/v2/users/sign_in` → cached bearer token; on a 401 the
  client re-signs-in ONCE and retries the request — a second 401 throws `HERMES_AUTH_FAILED`.
- Inbound webhook processing for `POST /api/v2/channels/hermes/:instanceId/webhook`
  (route mount lives in `@omni/api`).
- Capability declarations (24h messaging window, NO typing indicator).

## What it does NOT own

- DB schema / migrations → `@omni/db` (`instances.hermes_*` columns). This package must NOT import `@omni/db`.
- Shared Zod schemas → `@omni/core` (`packages/core/src/schemas/hermes.ts` envelope +
  `whatsapp-business.ts` inner message/status shapes).
- Webhook route mount → `@omni/api`.

## The media_id gotcha

`media_id` is NOT a file id — it is the **Hermes UUID of the WhatsApp LINE** (stored as
`instances.hermes_media_id`). It appears:

- on every outbound request (`message.media_id`, injected by `HermesClient`),
- as the upload query param (`POST /api/v2/upload?media_id=...`),
- on every webhook payload — where it is the **cross-check key**: the handler compares
  `payload.media_id` against the instance's configured line UUID and warn-logs + ignores
  mismatches (still 200 at the route level).

The `id` inside media messages / upload responses is the file id; `statuses[].id` is the
Hermes UUID returned by `POST /api/v2/messages` (`{ message: { id } }`) — that UUID is the
`SendResult.messageId` / `message.sent` externalId, so status webhooks correlate directly.

## Webhook contract

- **Per-instance path, NO signature**: Hermes signs nothing. Authenticity =
  unguessable `:instanceId` in the path + `media_id` cross-check. Never 4xx a bad payload.
- Bodies wrap Cloud-API-shaped inner objects:
  `{ contacts, messages: [<Cloud inbound msg>], media_id, message_type: "IN" }` and
  `{ statuses: [<Cloud status entry>], media_id }`.
- Inbound media carries a DIRECT `file` download URL (24h-lived S3 link) — surfaced as
  `content.mediaUrl`; `plugin.downloadInboundMedia(instanceId, fileUrl)` guards + fetches it.
  There is no media-lookup API dance like Meta's `GET /{media_id}`.
- Dedupe by `wamid` via `createInboundDedupeCache` (same as every other channel).

## Outbound shape quirks vs Meta Cloud API

- Envelope: `{ message: { media_id, to, recipient_type, type, ... } }`.
- `text` is a plain STRING (On-Premises style), not `{ body }`.
- Media rides FLAT on the message (`content_type` + `url` | `id`) — no nested `image: {}`.
  Stickers are the exception: `sticker: { link }` (public `.webp` URL only; no id form).
- Uploads (`POST /api/v2/upload`, raw body + Content-Type header) are capped at **2 MB**;
  bigger media must go by public URL.
- Templates need the per-line `namespace` (from `instances.hermes_template_namespace`,
  overridable via `metadata.template.namespace`) and
  `language: { policy: 'deterministic', code }`.

## Errors

Throw `HermesApiError(code, message, context)` everywhere. Mapping is HTTP-status based
(`mapHttpStatusToHermesError`): 401/403 → AUTH_FAILED (not retryable), 429 → RATE_LIMITED
(retryable), other 4xx → INVALID_REQUEST, 5xx → UPSTREAM_ERROR (retryable).

## Spec provenance

Extracted from the official **Mutant Postman collection ("Hermes API"; the brand spells it "H3rmes")** — endpoints,
payload examples and webhook fixtures all originate there. Features documented in the
collection but not implemented in v1: marketing messages lite, block users, conversions
events, CTA/product/catalog/flow/payment interactive variants, carousel/flow/payment
templates, inbound `nfm_reply` (Flows) messages.
