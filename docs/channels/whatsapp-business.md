# WhatsApp Cloud API (Meta) Channel

> Official WhatsApp Business integration via Meta's Cloud API. Webhook-based
> inbound, REST outbound, Embedded Signup OAuth, HSM templates.

## When to use this vs. WhatsApp (Baileys)

| Concern | `whatsapp-baileys` | `whatsapp-business` |
|---|---|---|
| Officiality | Unofficial (Baileys reverse-engineered protocol) | ✅ Official Meta API |
| Risk of number ban | Yes (Meta's anti-ToS detection) | No |
| Setup complexity | Low — just QR/phone pairing | Higher — requires Meta Business + Embedded Signup or WABA |
| 24h messaging window | No (free-form anytime) | Yes (only HSM templates outside window) |
| Templates / HSM | N/A | ✅ Required for marketing / out-of-window sends |
| Group chats | ✅ Supported | ❌ Not supported |
| Native delivery receipts | Limited | ✅ Native |
| Cost | Free | Per-conversation pricing (Meta) |
| Embedded Signup OAuth | N/A | ✅ Supported |

Use `whatsapp-business` for B2B, regulated industries, or any case where number-ban risk is unacceptable. Use `whatsapp-baileys` for consumer / community use cases or when group chats matter.

## Prerequisites

1. **Meta for Developers** account: <https://developers.facebook.com>
2. A **Meta App** (type: Business) with the **WhatsApp Business** product added.
3. **Business Verification** completed in Meta Business Manager (required for production access).
4. **System User** with a long-lived access token (preferred over user tokens, which expire in 60 days).
5. **Embedded Signup configuration_id** (optional but recommended — enables one-click WABA onboarding from your UI).

## Setup

### 1. Configure env vars

Add to `.env`:

```bash
# WhatsApp Cloud API (Meta) — global app-level config
META_APP_ID=1234567890123456                  # Facebook App ID
META_APP_SECRET=<your-app-secret>             # Used to verify X-Hub-Signature-256 — NEVER commit
META_VERIFY_TOKEN=<random-shared-secret>      # Matches what you set in Meta App > WhatsApp > Webhooks UI
META_GRAPH_API_VERSION=v25.0                  # Optional override (default v25.0)
META_EMBEDDED_SIGNUP_CONFIG_ID=<config-id>    # Optional — required only for in-UI Embedded Signup flow
META_WEBHOOK_BASE_URL=https://api.example.com # Public URL Meta should hit (only used in setup docs)
```

`META_APP_SECRET` is per-app and never per-instance. `META_VERIFY_TOKEN` is shared across all instances pointing to this Meta App — it's just a handshake secret for webhook subscription verification.

### 2. Configure the webhook in Meta

In Meta App Dashboard → **WhatsApp** → **Configuration**:

1. **Callback URL**: `${META_WEBHOOK_BASE_URL}/api/v2/channels/whatsapp-business/webhook`
2. **Verify Token**: same value as `META_VERIFY_TOKEN` in your env.
3. **Webhook Fields** to subscribe to (all of these — Omni emits a `channel.alert` core event for the WABA-scoped ones):
   - `messages` — inbound messages + outbound status updates (REQUIRED)
   - `message_template_status_update` — HSM template approvals/rejections
   - `account_alerts` — WABA compliance / suspension warnings
   - `account_update` — account-level state changes (banned, verified, etc.)
   - `phone_number_quality_update` — quality_rating drops (GREEN → YELLOW → RED)
   - `phone_number_name_update` — verified_name approvals / rejections
   - For a number that stays on the WhatsApp Business app (coexistence): `smb_message_echoes`, `history`,
     `smb_app_state_sync` — see [Coexistence](#coexistence-whatsapp-business-app-on-the-same-number)

Meta will GET your webhook URL with `hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<n>`. Omni's handler responds with the challenge if the token matches.

### Legacy URLs (channel renamed from `whatsapp-cloud`)

This channel was called `whatsapp-cloud` until 2026-08 ("Cloud API" named a
distinction against Meta's On-Premises API, retired in Oct/2025). Every old
URL keeps working **permanently** — do not rush to reconfigure Meta apps:

| Legacy (frozen alias) | Canonical |
|---|---|
| `/api/v2/channels/whatsapp-cloud/webhook` | `/api/v2/channels/whatsapp-business/webhook` |
| `/api/v2/channels/whatsapp-cloud/flows/data/:instanceId` | `/api/v2/channels/whatsapp-business/flows/data/:instanceId` |
| `/api/v2/instances/:id/whatsapp-cloud/*` | `/api/v2/instances/:id/whatsapp-business/*` |

Stored data was migrated (`instances.channel` etc. → `whatsapp-business`,
migration 0047); historical `omni_events` jsonb payloads keep the old
`channelType` value — queries over historical events must match both.

### 3. Onboard a phone number

You have two paths:

#### Path A — Embedded Signup (recommended for end-users)

1. In Omni UI: click "Add Instance" → channel "WhatsApp Cloud API" → choose "Embedded Signup".
2. Meta JS SDK pops a Facebook login dialog with `FB.login({ config_id: META_EMBEDDED_SIGNUP_CONFIG_ID })`.
3. User authorizes; the SDK returns a short-lived `code`.
4. Omni POSTs the code to `/api/v2/instances/:id/whatsapp-business/oauth/exchange` which:
   - Exchanges code → long-lived `access_token` via `/oauth/access_token`.
   - Discovers WABAs + phone numbers via `/me/businesses` + `/{waba_id}/phone_numbers`.
5. User picks the phone to onboard.
6. Omni POSTs `/connect` → persists token + IDs → registers number → subscribes app to WABA webhook.

#### Path B — Manual paste (for dev / tenants with pre-existing WABA)

1. In Omni UI: pick "Manual" tab on the WhatsApp Cloud connect dialog.
2. Paste:
   - **Access Token** (System User token from Meta Business → System Users → Generate Token).
   - **Phone Number ID** (Meta App → WhatsApp → API Setup → "Phone number ID").
   - **WABA ID** (Meta App → WhatsApp → API Setup → "WhatsApp Business Account ID").
3. Click "Connect" → Omni validates the token via `GET /{phone_number_id}` and persists.

Or via CLI:

```bash
omni instances connect <instance-id> \
  --access-token <token> \
  --phone-number-id <pnid> \
  --waba-id <waba>
```

### 4. (If new number) Register

For numbers added via Embedded Signup, Meta requires a 6-digit PIN registration before the number can send:

```http
POST /api/v2/instances/:id/whatsapp-business/register
{ "pin": "123456" }
```

The PIN is one you set during onboarding — it's also required if you ever de-register and re-register.

## Sending messages

### Free-form text (inside 24h window)

```bash
omni send --to +5511999998888 --text "Hi!" --instance <instance-id>
```

Or via REST:

```http
POST /api/v2/messages/send
{ "instanceId": "...", "to": "+5511999998888", "text": "Hi!" }
```

### Templates (outside 24h window or first contact)

```http
POST /api/v2/instances/:id/whatsapp-templates/welcome/send
{
  "to": "+5511999998888",
  "language": "pt_BR",
  "variables": { "1": "Bruno" },
  "headerMedia": { "type": "image", "url": "https://example.com/img.jpg" }
}
```

The template must be **approved** by Meta beforehand (status: `APPROVED` in `/whatsapp-templates`).

### Other content types

`image`, `audio`, `video`, `document`, `sticker`, `location`, `contact`, `reaction`. See `packages/channel-whatsapp-business/src/senders/` for each builder.

## Channel alerts (WABA-scoped webhooks)

Beyond message + template lifecycle, Meta pushes operator-facing alerts on the WABA itself: quality drops, account flags, verified-name decisions. Omni normalizes all four Meta webhook fields (`account_alerts`, `account_update`, `phone_number_quality_update`, `phone_number_name_update`) into a single `channel.alert` core event with shape:

```ts
{
  instanceId: string;
  channelType: 'whatsapp-business';
  alertType: 'account_alerts' | 'account_update' | 'phone_number_quality_update' | 'phone_number_name_update' | 'other';
  severity: 'info' | 'warning' | 'critical';   // inferred — see source
  message: string;                              // best-effort human summary
  entityType?: string;                          // from Meta's entity_type
  entityId?: string;                            // from Meta's entity_id
  data?: Record<string, unknown>;               // raw Meta payload
}
```

A single Meta webhook fans out to N events when N Omni instances share the WABA. Subscribe via `eventBus.subscribe('channel.alert', …)` from any consumer (notification worker, dashboard badge, etc.).

## Coexistence (WhatsApp Business app on the same number)

A number onboarded through Embedded Signup coexistence keeps working in the WhatsApp Business app. Meta mirrors the
app into three webhook fields; Omni records them like this:

| Meta field | Omni |
|---|---|
| `smb_message_echoes` — the business sent a message from the app or a companion device | `message.received` in the customer's chat with `rawPayload.isFromMe`, `key.fromMe`, `key.id` and `upsertType: 'notify'` (the shape of a Baileys phone-sent message). An API send emits `message.sent` instead, so the two never mix. **Omni's agents are never dispatched for an echo.** DSH automations that opt in to the owner's own messages (`allowOutbound`) still see it. Reaction echoes are not recorded yet. |
| `history` — chats shared once at onboarding (up to 180 days) | `message.received` with `ingestMode: 'history-sync'`: the chats fill with their past and no agent is dispatched. Media arrives as `media_placeholder` (skipped); Meta sends the asset of messages from the last 14 days in a later `history` webhook, which Omni records in the same chat. Code `2593109` (the business declined sharing) is logged. |
| `smb_app_state_sync` — the app's contacts | Stored per instance, named in DM chats at once (`custom.contacts.names`), and upserted as identities by the next contacts sync (daily, or a manual contacts sync). Contacts without a phone number are skipped. |

Echoes and history carry `rawPayload.noAgentDispatch`, the channel-neutral marker the agent dispatcher drops.

## Through a Meta-compatible provider (Kapso)

A provider such as Kapso holds the Meta connection and exposes the same Graph API under its own base URL and key.
Omni then talks to the provider instead of `graph.facebook.com`. Four optional connect fields set this per instance;
an instance without them is Meta direct, exactly as before.

| Field | Meta direct (default) | Kapso |
|---|---|---|
| `apiBaseUrl` | unset → `https://graph.facebook.com/{version}` | `https://api.kapso.ai/meta/whatsapp/v24.0` (https only) |
| `authMode` | `bearer` → `Authorization: Bearer <accessToken>` | `x-api-key` → `X-API-Key: <accessToken>` (the Kapso project key) |
| `webhookSecret` | unset (or the instance's own Meta app secret) | the secret of the Kapso webhook that forwards Meta events |
| `signatureMode` | `x-hub-signature-256` (with `webhookSecret` when set, else `META_APP_SECRET`) | `x-webhook-signature` (hex HMAC-SHA256 of the raw body with `webhookSecret`) |

```bash
omni instances connect <instance-id> \
  --access-token <kapso-project-key> \
  --phone-number-id <pnid> \
  --waba-id <waba> \
  --api-base-url https://api.kapso.ai/meta/whatsapp/v24.0 \
  --auth-mode x-api-key \
  --webhook-secret <kapso-webhook-secret> \
  --signature-mode x-webhook-signature
```

- **Webhook.** Point the Kapso webhook ("Meta webhook forwarding") at the same global URL,
  `${META_WEBHOOK_BASE_URL}/api/v2/channels/whatsapp-business/webhook`. Omni finds every instance a body addresses
  (by `phone_number_id`, or by WABA for alerts and template status) and checks each one's own mode and secret. A
  provider instance needs `X-Webhook-Signature` with its secret; an `X-Hub-Signature-256` signed with
  `META_APP_SECRET` never stands in for it. An instance on `x-hub-signature-256` with its own `webhookSecret` (its own
  Meta app) verifies with that secret only. `META_APP_SECRET` is used only for Meta-direct instances without a secret,
  and for bodies that address no connected instance; it is not needed when every instance has its own secret.
- **Re-connect.** A connect that omits a provider field keeps the stored value; `null` clears it (a mode resets to
  Meta's default). `authMode: x-api-key` without a provider `apiBaseUrl` (unset, or a Meta host such as
  `graph.facebook.com`), and `signatureMode: x-webhook-signature` without `webhookSecret`, are refused with 400.
- **Media.** Downloads use the provider's `download_url` (no key needed); a media URL off the provider's origin is
  refused, and a provider key is never sent to a Meta host.
- **Meta-only routes.** Number registration, app subscription, conversation analytics, profile photo upload and
  template header media upload use Meta's own app-scoped endpoints. A provider instance gets
  `400 NOT_SUPPORTED_VIA_PROVIDER`; do these in the provider's dashboard.
- The webhook secret is stored like `metaAccessToken` (plain column) and never returned: `GET .../connection` shows
  `hasWebhookSecret` only.

### By clicks (Omni Channels plugin)

In the Omni Channels DSH plugin, Add a channel → WhatsApp Business → **Through Kapso** does all of the above without
typing an ID. Omni makes every Kapso call itself, with one Kapso project key per deployment:

1. **Key**, asked only while Omni has none. `PUT /channels/whatsapp-business/kapso/key` checks it with Kapso, then
   stores the sealed install-wide setting `kapso.api_key` (env fallback `KAPSO_API_KEY`). No route returns it.
2. **Create setup link** opens Kapso's page in a new tab (`POST .../kapso/setup-link`): a coexistence link, so the
   number keeps working in the WhatsApp Business app; no number is provisioned. It is made for this Omni's Kapso
   customer, created on first use and remembered in `kapso.customer_id`. A new link revokes the previous one.
3. **Pick a number** from the project's list (`GET .../kapso/numbers`, with a refresh), then **Connect**
   (`POST /instances/:id/whatsapp-business/kapso/connect`): Omni points that number's Meta-forwarding webhook (kind
   `meta`; an existing one is updated) at `${server.public_url}/api/v2/channels/whatsapp-business/webhook` with a
   secret it generates, and connects with the Kapso base URL, `x-api-key` and `x-webhook-signature`.
4. **Send a test message** to a number you type. WhatsApp delivers it only inside the 24-hour window.

`kapso.api_base_url` (env `KAPSO_API_BASE_URL`) overrides `https://api.kapso.ai`. Without a public https
`server.public_url` (env `OMNI_PUBLIC_URL`) the connect stops before anything is created. With multitenancy on, every
Kapso route answers `409 KAPSO_NOT_AVAILABLE`: the key is install-wide. The Kapso routes need `instances:write`
(`numbers`: `instances:read`), which a paired device's key carries.

## Templates HSM lifecycle

```
draft (UI)  →  POST /whatsapp-templates  →  PENDING
                                              ↓
                              Meta review (1–24h)
                                              ↓
                  APPROVED ─→ usable      REJECTED ─→ see rejectionReason
                                              ↓
                          (paused for quality / disabled)
                                              ↓
                                       message_template_status_update webhook
                                              ↓
                              template.status_changed event published
```

Use the `template.status_changed` core event (`packages/core/src/events/types.ts`) to wire notifications when templates are approved or rejected. Filter on `payload.newStatus`.

## Troubleshooting

### Webhook returns 401

- `X-Hub-Signature-256` HMAC mismatch. Check `META_APP_SECRET` matches the App you're using.
- Through a provider: `X-Webhook-Signature` must verify with the instance's `webhookSecret`, and the instance must have
  `signatureMode: x-webhook-signature`. Every instance the body addresses must verify with its own secret.
- Common cause: editing the App Secret in Meta dashboard but not updating env.

### Webhook returns 200 but no events fire

- Meta payload `metadata.phone_number_id` does NOT match any connected Omni instance — Omni returns 200 + log warning (NEVER 4xx, or Meta disables your app).
- Check: `omni instances list` → confirm the instance has `metaPhoneNumberId` set.

### Send fails with `OMNI_OUTSIDE_24H_WINDOW`

- The customer hasn't sent a message in the last 24h. Free-form is blocked by Meta. Send an approved HSM template instead.

### Send fails with `META_TEMPLATE_NOT_APPROVED`

- Template status is `PENDING` / `REJECTED` / `PAUSED`. Check `/whatsapp-templates/:id`.

### Send fails with `META_RECIPIENT_NOT_FOUND` (131026)

- Recipient is not a WhatsApp user. Validate the phone number is registered with WhatsApp before retry.

### Quality rating dropped to RED

- Meta lowered your number's quality due to user reports / blocks. Pull `/whatsapp-business/quality` to inspect. Reduce send volume + improve template targeting.

## Privacy / PII

Sentry scrubbing in `packages/api/src/lib/sentry-scrub.ts` masks the following from any captured event:

- `text` / `body` / `caption` / `description` field values → `[redacted]`.
- `access_token` / `authorization` / `verify_token` / `app_secret` field values → `[redacted]`.
- `profile_name` / `verified_name` / `display_name` field values → `[redacted]`.
- Free-text patterns: phone numbers → `[phone]`, JIDs → `[jid]`, emails → `[email]`, Meta tokens (EAA prefix, 40+ chars) → `[meta_token]`, Bearer headers → `Bearer [token]`.

Audited via `packages/api/src/lib/__tests__/sentry-scrub-whatsapp-business-audit.test.ts` — every release runs this against a synthetic Meta event fixture.

## References

- **Cloud API reference**: <https://developers.facebook.com/docs/whatsapp/cloud-api>
- **Embedded Signup**: <https://developers.facebook.com/docs/whatsapp/embedded-signup>
- **Templates**: <https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates>
- **Webhook signature**: <https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validating-payloads>
- **Phone registration**: <https://developers.facebook.com/docs/whatsapp/cloud-api/reference/registration>
- **Error codes**: <https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes>
