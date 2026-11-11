# channel-whatsapp-business — Patterns

> Package-local conventions for the WhatsApp Cloud (Meta) channel plugin.
> For the broader Omni architecture see `../../AGENTS.md` and `../../.claude/CLAUDE.md`.

## What this package owns

- Outbound REST calls to Graph API v25.0 (`graph.facebook.com/{version}`).
- Inbound webhook (HMAC-SHA256 signed) at `/api/v2/channels/whatsapp-business/webhook`.
- OAuth Embedded Signup helpers (`exchangeCodeForToken`, `getWabaDetails`, `registerPhoneNumber`, `subscribeApp`).
- HSM template CRUD + sync with `whatsapp_templates` table.
- Capability declarations (24h messaging window, supported media types, etc.).

## What it does NOT own

- DB schema / migrations → `@omni/db` (`packages/db/`).
- Shared Zod schemas → `@omni/core` (`packages/core/src/schemas/whatsapp-business.ts`).
- Shared types → `@omni/core` (`packages/core/src/types/whatsapp-business.ts`).
- REST routes for OAuth / templates → `@omni/api` (`packages/api/src/routes/v2/whatsapp-business.ts`, `routes/v2/templates.ts`).
- Webhook route mount → `@omni/api` (`packages/api/src/app.ts`).
- Sentry scrubbing → `@omni/api` (`packages/api/src/lib/sentry-scrub.ts`).

This package is a **plugin**, not a service. It exposes `WhatsAppBusinessPlugin` as default export, registered by the bundled server entry.

## File map

```
src/
├── plugin.ts                    # WhatsAppBusinessPlugin class — lifecycle + dispatch
├── client.ts                    # MetaWhatsAppClient — Graph API wrapper (fetch-based)
├── capabilities.ts              # WHATSAPP_BUSINESS_CAPABILITIES (hasMessagingWindow, sticker, buttons, etc.)
├── types.ts                     # Internal types (WhatsAppBusinessConfig, MetaOutboundMessage, …)
├── oauth.ts                     # exchangeCodeForToken / getWabaDetails / registerPhoneNumber / subscribeApp
├── templates.ts                 # Template CRUD + sync helpers
├── coexistence.ts               # Business app coexistence: rawPayload evidence, contact store helpers
├── senders/                     # One file per outbound content type
│   ├── text.ts
│   ├── media.ts                 # image / audio / video / document / sticker
│   ├── location.ts
│   ├── contact.ts
│   ├── reaction.ts
│   ├── template.ts
│   └── flow.ts                  # interactive.flow (navigate + data_exchange, structured flow tokens)
├── flows/
│   └── resolver.ts              # FlowResolverRegistry + buildFlowToken/parseFlowToken
├── handlers/
│   ├── webhook.ts               # handleVerifyChallenge + handleMetaWebhook
│   └── flow-data.ts             # encrypted Flows data-exchange endpoint (200/421/427/432)
├── utils/
│   ├── identity.ts              # toMetaPhone (digits-only), toE164, phonesEqual
│   ├── errors.ts                # MetaApiError + MetaErrorCode taxonomy
│   ├── signature.ts             # verifyMetaSignature (HMAC-SHA256, timing-safe)
│   └── flow-crypto.ts           # RSA-OAEP unwrap + AES-128-GCM (flipped-IV response), keygen
└── __tests__/                   # bun:test
    ├── senders.test.ts
    ├── webhook.test.ts
    ├── templates.test.ts
    └── oauth.test.ts

Cross-package audit (lives in @omni/api because it imports the scrub module):
  packages/api/src/lib/__tests__/sentry-scrub-whatsapp-business-audit.test.ts
                                  # Fixture-based audit of beforeSend coverage
                                  # for Meta-shaped events (tokens, phones,
                                  # profile_name, message body).
```

## Conventions

### Phone numbers

- **Wire format (Meta)**: digits only (no `+`). Always normalize via `toMetaPhone(input)` from `src/utils/identity.ts` before sending.
- **Omni internal format**: E.164 with leading `+`. Convert back via `toE164(metaPhone)` when emitting events.
- Inbound `from`, `to`, `display_phone_number` from Meta are already digits-only.

### Errors

- Throw `MetaApiError(code, message, context)` for every failure path. The plugin's `sendMessage` converts these into `SendResult` with `success: false`.
- Error codes are normalized via `mapHttpStatusToMetaError(numeric)` in `utils/errors.ts`. Add new codes there, not inline.
- `MetaApiError.retryable` is consulted by callers — set it correctly for rate limits (yes), upstream 5xx (yes), auth failures (no).

### Tokens

- `metaAccessToken` is stored **plain text** in `instances.meta_access_token` (parity with `discord_bot_token`, `telegram_bot_token`, `gupshup_auth_token`). Encryption at-rest is repo-wide tech debt — do NOT add column-level encryption here in isolation.
- NEVER log the access token. Sentry scrubbing (`@omni/api/src/lib/sentry-scrub.ts`) masks `EAA<…>` patterns and `Authorization` headers.
- `metaWebhookSecret` (provider webhook secret) follows the same rule: plain column, never logged, never returned.

### Webhook resolution

The Meta webhook is **global** — there is no `:instanceId` in the path. Instance is resolved from the payload's `metadata.phone_number_id` via `plugin.findInstanceByPhoneNumberId(...)`. If no instance matches: **return 200 with a warning log**. NEVER 4xx — Meta disables the app after repeated retries.

### Idempotency

Inbound `wamid` values must be deduped via `createInboundDedupeCache` (shared with other channels in `@omni/channel-sdk`). Same `wamid` POSTed twice → emit `message.received` only once.

### Signature verification

`X-Hub-Signature-256: sha256=<hex>` over the **raw request body** using HMAC-SHA256 with `META_APP_SECRET`. Compare using a constant-time check (Web Crypto `crypto.subtle` + manual constant-time byte compare). Reject with 401 + warn-log on mismatch — do not include any token diff in the log.

Verification is per instance (`verifyWebhookSignature` in `handlers/webhook.ts`). Every instance the body addresses —
routed exactly as the handlers route it (phone_number_id, or WABA for alerts and template status) — must pass its own
check: `x-webhook-signature` (a provider such as Kapso: bare hex HMAC with the instance's `webhookSecret`), or
`x-hub-signature-256` with the instance's `webhookSecret` when set, else `META_APP_SECRET`. The app secret never
stands in for an instance that has its own secret. A body addressing no connected instance is checked with
`META_APP_SECRET`.

### Meta-compatible provider

`MetaWhatsAppClient` takes `baseUrl` + `authMode` (`bearer` | `x-api-key`). `authMode` only applies with a provider
`baseUrl`; `x-api-key` with a base on a Meta host (`isMetaHostUrl`) throws, so a provider key never reaches Meta.
`downloadMedia` uses the provider's `download_url` and refuses either media URL off the provider origin. Template `paging.next` URLs are reduced to a path under the client's base. The API
side builds every client through `metaClientTransport(instance)` (`@omni/api` `lib/whatsapp-business-connection.ts`)
and refuses Meta-only routes for a provider instance with `metaOnlyRouteError`.

### WhatsApp Flows

Full guide: `docs/channels/whatsapp-flows.md`. Package-side pieces: the flow
sender emits structured tokens `omni.<flowId>.<uuid>` (the data endpoint's only
way to know which flow it serves); `handlers/flow-data.ts` owns the encrypted
data-exchange contract (421 = can't decrypt → check key `signature_status`,
427 = bad token, 432 = bad HMAC); screen logic registers on
`plugin.flowResolvers` and must resolve within ~8s. Private keys are unsealed
by the API route (`app.ts`), never read here.

### Coexistence (WhatsApp Business app on the same number)

Three webhook fields mirror the Business app; all resolve the instance by `metadata.phone_number_id`:

- `smb_message_echoes` → `handleMessageEcho`: `message.received` in the customer's chat (`to`) with own-device
  evidence on rawPayload (`isFromMe`, `key.id`, `key.fromMe`, `upsertType: 'notify'`; no `key.remoteJid`), so it is
  never confused with an API send (`message.sent`). It carries `rawPayload.noAgentDispatch`, so Omni's agent
  dispatcher never dispatches it (owner decision 2026-11-11). DSH automations with `allowOutbound` still see it.
  Reaction echoes are skipped.
- `history` → `handleHistoryMessage`: `ingestMode: 'history-sync'` with `rawPayload.messageTimestamp` (persistence
  drops a history message without it) and `noAgentDispatch`. `media_placeholder` is skipped; its asset arrives later
  as `value.messages` on the same field and finds its chat through `historyPlaceholderChats`.
- `smb_app_state_sync` → `handleContactSync`: stored in plugin storage (`coexistence-contact:<instanceId>:<phone>`),
  read by `fetchContacts` for the contacts sync job (identity upsert), and announced on `custom.contacts.names`.

### 24h window enforcement

Meta enforces this server-side — we don't pre-check. When a send attempt fails with code `131047` or `131051`, the client returns `MetaApiError(OMNI_OUTSIDE_24H_WINDOW)` and the caller (agent dispatcher) can switch to a template send.

The follow-up sweeper (`@omni/core/src/automations/follow-up`) consumes `hasMessagingWindow: true` + `messagingWindowMs: 24h` from `WHATSAPP_BUSINESS_CAPABILITIES` to disarm sequences past the window.

## Adding a new sender

1. Create `src/senders/<type>.ts` with a function `send<Type>(client, to, …): Promise<MetaSendResponse>`.
2. The function should build a `MetaOutboundMessage` object and call `client.sendMessage(payload)`.
3. Add a unit test in `__tests__/senders.test.ts` mocking the client.
4. Wire the new content type into `plugin.ts::sendMessage` dispatch logic.
5. Update `WHATSAPP_BUSINESS_CAPABILITIES` if the new sender changes capabilities.

## Adding a new webhook event

1. If it's a new Zod-validated shape → add it to `packages/core/src/schemas/whatsapp-business.ts`.
2. If it's a new domain event → add it to `packages/core/src/events/types.ts` (`CORE_EVENT_TYPES` tuple + payload interface + `EventPayloadMap` entry).
3. Parse and dispatch in `src/handlers/webhook.ts`.
4. Add a fixture-based test in `__tests__/webhook.test.ts`.

## Talkflow → Omni reference map

The Python source we ported from:

| Talkflow file | Omni file |
|---|---|
| `meta_oauth_service.py` | `src/oauth.ts` |
| `meta_template_service.py` | `src/templates.ts` |
| `meta_whatsapp_client.py` | `src/client.ts` |
| `meta_webhook_routes.py` | `src/handlers/webhook.ts` + `@omni/api` mount |
| `meta_whatsapp_routes.py` | `@omni/api/src/routes/v2/whatsapp-business.ts` |
| `meta_template_routes.py` | `@omni/api/src/routes/v2/templates.ts` |
| Pydantic schemas | `packages/core/src/schemas/whatsapp-business.ts` |
| `MetaTemplate` SQLAlchemy model | `packages/db/src/schema.ts::whatsappTemplates` |
