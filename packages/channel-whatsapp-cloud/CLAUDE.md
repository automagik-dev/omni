# channel-whatsapp-cloud — Patterns

> Package-local conventions for the WhatsApp Cloud (Meta) channel plugin.
> For the broader Omni architecture see `../../AGENTS.md` and `../../.claude/CLAUDE.md`.

## What this package owns

- Outbound REST calls to Graph API v25.0 (`graph.facebook.com/{version}`).
- Inbound webhook (HMAC-SHA256 signed) at `/api/v2/channels/whatsapp-cloud/webhook`.
- OAuth Embedded Signup helpers (`exchangeCodeForToken`, `getWabaDetails`, `registerPhoneNumber`, `subscribeApp`).
- HSM template CRUD + sync with `whatsapp_templates` table.
- Capability declarations (24h messaging window, supported media types, etc.).

## What it does NOT own

- DB schema / migrations → `@omni/db` (`packages/db/`).
- Shared Zod schemas → `@omni/core` (`packages/core/src/schemas/whatsapp-cloud.ts`).
- Shared types → `@omni/core` (`packages/core/src/types/whatsapp-cloud.ts`).
- REST routes for OAuth / templates → `@omni/api` (`packages/api/src/routes/v2/whatsapp-cloud.ts`, `routes/v2/templates.ts`).
- Webhook route mount → `@omni/api` (`packages/api/src/app.ts`).
- Frontend UI → `apps/ui`.
- Sentry scrubbing → `@omni/api` (`packages/api/src/lib/sentry-scrub.ts`).

This package is a **plugin**, not a service. It exposes `WhatsAppCloudPlugin` as default export, registered by the bundled server entry.

## File map

```
src/
├── plugin.ts                    # WhatsAppCloudPlugin class — lifecycle + dispatch
├── client.ts                    # MetaWhatsAppClient — Graph API wrapper (fetch-based)
├── capabilities.ts              # WHATSAPP_CLOUD_CAPABILITIES (hasMessagingWindow, sticker, buttons, etc.)
├── types.ts                     # Internal types (WhatsAppCloudConfig, MetaOutboundMessage, …)
├── oauth.ts                     # exchangeCodeForToken / getWabaDetails / registerPhoneNumber / subscribeApp
├── templates.ts                 # Template CRUD + sync helpers
├── senders/                     # One file per outbound content type
│   ├── text.ts
│   ├── media.ts                 # image / audio / video / document / sticker
│   ├── location.ts
│   ├── contact.ts
│   ├── reaction.ts
│   └── template.ts
├── handlers/
│   └── webhook.ts               # handleVerifyChallenge + handleMetaWebhook
├── utils/
│   ├── identity.ts              # toMetaPhone (digits-only), toE164, phonesEqual
│   ├── errors.ts                # MetaApiError + MetaErrorCode taxonomy
│   └── signature.ts             # verifyMetaSignature (HMAC-SHA256, timing-safe)
└── __tests__/                   # bun:test
    ├── senders.test.ts
    ├── webhook.test.ts
    ├── templates.test.ts
    └── oauth.test.ts

Cross-package audit (lives in @omni/api because it imports the scrub module):
  packages/api/src/lib/__tests__/sentry-scrub-whatsapp-cloud-audit.test.ts
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

### Webhook resolution

The Meta webhook is **global** — there is no `:instanceId` in the path. Instance is resolved from the payload's `metadata.phone_number_id` via `plugin.findInstanceByPhoneNumberId(...)`. If no instance matches: **return 200 with a warning log**. NEVER 4xx — Meta disables the app after repeated retries.

### Idempotency

Inbound `wamid` values must be deduped via `createInboundDedupeCache` (shared with other channels in `@omni/channel-sdk`). Same `wamid` POSTed twice → emit `message.received` only once.

### Signature verification

`X-Hub-Signature-256: sha256=<hex>` over the **raw request body** using HMAC-SHA256 with `META_APP_SECRET`. Compare using a constant-time check (Web Crypto `crypto.subtle` + manual constant-time byte compare). Reject with 401 + warn-log on mismatch — do not include any token diff in the log.

### 24h window enforcement

Meta enforces this server-side — we don't pre-check. When a send attempt fails with code `131047` or `131051`, the client returns `MetaApiError(OMNI_OUTSIDE_24H_WINDOW)` and the caller (agent dispatcher) can switch to a template send.

The follow-up sweeper (`@omni/core/src/automations/follow-up`) consumes `hasMessagingWindow: true` + `messagingWindowMs: 24h` from `WHATSAPP_CLOUD_CAPABILITIES` to disarm sequences past the window.

## Adding a new sender

1. Create `src/senders/<type>.ts` with a function `send<Type>(client, to, …): Promise<MetaSendResponse>`.
2. The function should build a `MetaOutboundMessage` object and call `client.sendMessage(payload)`.
3. Add a unit test in `__tests__/senders.test.ts` mocking the client.
4. Wire the new content type into `plugin.ts::sendMessage` dispatch logic.
5. Update `WHATSAPP_CLOUD_CAPABILITIES` if the new sender changes capabilities.

## Adding a new webhook event

1. If it's a new Zod-validated shape → add it to `packages/core/src/schemas/whatsapp-cloud.ts`.
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
| `meta_whatsapp_routes.py` | `@omni/api/src/routes/v2/whatsapp-cloud.ts` |
| `meta_template_routes.py` | `@omni/api/src/routes/v2/templates.ts` |
| Pydantic schemas | `packages/core/src/schemas/whatsapp-cloud.ts` |
| `MetaTemplate` SQLAlchemy model | `packages/db/src/schema.ts::whatsappTemplates` |
