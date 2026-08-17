# @omni/channel-asc

WhatsApp channel plugin for the **ASC Brazil** BSP gateway ("ASCWhats GW",
`https://apigw.ascbrazil.com.br`) — a thin proxy over the official WhatsApp
Cloud API.

## How it maps to the gateway

- **Outbound** — everything goes through `POST /api/v1/messages`, a faithful
  mirror of Graph `POST /{phone_number_id}/messages` (ASC's per-type
  `sendText`/`sendImage`/… endpoints are not used; one endpoint covers all).
- **Inbound** — ASC delivers webhooks in the **official Meta Cloud API
  format** (`entry[].changes[].value`), so parsing reuses the shared
  `MetaWebhookPayloadSchema` / `MetaInboundMessage` from `@omni/core`.
- **Auth** — two static headers on every call: `originador` (WABA phone,
  digits-only E.164) + `asc-token`.
- **Typing** — `POST /api/v1/sendTypingIndicator` requires the wamid of the
  newest RECEIVED message (Cloud API semantics; it also marks that message
  as read). The plugin remembers the last inbound wamid per chat; chats with
  no remembered wamid no-op silently.

## Instance config

| Key                  | Required | Notes                                              |
| -------------------- | -------- | -------------------------------------------------- |
| `ascToken`           | yes      | `asc-token` header                                 |
| `ascOriginador`      | yes      | WABA phone number, digits-only E.164               |
| `ascBaseUrl`         | no       | defaults to `https://apigw.ascbrazil.com.br`       |
| `webhookVerifyToken` | no       | the `chave` registered via ASC `POST /setWebhook`  |

Webhook URL to register with ASC (`POST /api/v1/setWebhook` `{url, chave}`):
`{OMNI_BASE_URL}/api/v2/channels/asc/{instanceId}/webhook`. The GET challenge
(`hub.challenge` echo) validates `hub.verify_token` against
`webhookVerifyToken` when set.

## v1 scope

Outbound: text (with interactive buttons/lists via the shared
`planInteractive`), image/audio/video/document/sticker (public URL link),
location, contacts, reply (`context.message_id`), template
(`metadata.template` passthrough), reactions (`/api/v1/reactMessage`).
Inbound: text, media (download via `downloadInboundMedia` → ASC's
`getDownloadMedia`/`downloadMedia` proxy), button/list replies, location,
contacts, reactions, statuses (delivered/read/failed), dedupe by wamid.

**Out of scope (v2):** Flows, catalog/commerce, QR codes, Calling API,
contact block, template CRUD, media upload (`uploadMedia` has no documented
schema — media sends are link-only).

## Known ASC doc gaps (open questions for the vendor)

- Error envelope undocumented (most endpoints only declare a 200) — non-2xx
  is classified by HTTP status alone (401/403 auth = non-retryable, 429/5xx
  = retryable) with the response body logged.
- Rate limits undocumented.
- No mention of `X-Hub-Signature-256` webhook signing — the webhook relies
  on the unguessable per-instance URL plus the optional verify token.
- `/api/v1/messages` `type` enum omits `video`, but the endpoint mirrors
  Graph and `/api/v1/sendVideo` exists — video is sent through `/messages`
  as on Graph.
