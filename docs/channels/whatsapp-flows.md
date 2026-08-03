# WhatsApp Flows

WhatsApp Flows are in-chat interactive forms/screens (Meta Cloud API channel
only). Omni supports the full lifecycle: create/update/publish flows via API,
send them as interactive messages, receive completions, and — for **dynamic
flows** — host Meta's encrypted data-exchange endpoint so screens can be
resolved server-side mid-flow.

## Two flavors

| | Static (`navigate`) | Dynamic (`data_exchange`) |
|---|---|---|
| Screens | All in Flow JSON, resolved on-device | Decided per-step by omni's data endpoint |
| Server calls during the flow | None | `INIT` → screen, each submit → next screen |
| Requirements | Published/draft flow | + encryption keys + `META_FLOWS_PUBLIC_BASE_URL` + a registered resolver |
| Result delivery | `nfm_reply` webhook at completion | Same, plus per-step `flow.data_exchange` events |

## Management API

All routes live under `/api/v2/instances/:id/whatsapp-flows` (scope:
`instances:read`/`instances:write`).

```
GET    /                       list flows
POST   /                       create  { name, categories, flowJson?, publish?, dynamic? }
GET    /:flowId                status + validationErrors + endpointUri + preview
PUT    /:flowId                update  { flowJson?, name?, categories?, dynamic? }
DELETE /:flowId                delete (DRAFT only)
POST   /:flowId/publish        publish
POST   /:flowId/deprecate      retire a published flow
GET    /:flowId/preview        browser preview URL
POST   /send                   send  { to, flowId|flowName, cta, bodyText, ..., flowAction? }
POST   /keys                   generate + register encryption keys (repeat = rotate)
GET    /keys                   key status (local presence + Meta signature_status)
```

Create/update run **local Flow JSON validation** (`validateFlowJson` in
`@omni/core`) before contacting Meta — catching the errors Meta reports only
after an upload round-trip (or not at all) — and always return Meta's
`validationErrors` in the response.

### Flow JSON gotchas (enforced locally)

- `RichText.text` must be a **string** (arrays fail v6.3 validation).
- `RichText` must be **alone on its screen** (Footer excepted).
- `data_api_version` ⇔ dynamic: a flow with `data_api_version` but no
  registered `endpoint_uri` shows **"an error occurred"** on open, with no
  webhook trace. `dynamic: true` wires the endpoint and requires
  `data_api_version: '3.0'`; static flows must omit it.
- At least one `terminal: true` screen; `routing_model` / `navigate` targets
  must reference declared screens.

### Authoring DX

Use the SDK's fluent builder (`@omni/sdk` → `flow()`) instead of hand-writing
JSON — it enforces the same rules at `build()` time:

```typescript
import { flow } from '@omni/sdk';

const { flowJson } = flow({ version: '6.3' })
  .screen('INTRO', { title: 'Welcome' }, (s) => {
    s.image(base64Png, { height: 240 });
    s.heading('Hi there!');
    s.footerNavigate('Start', 'FORM');
  })
  .screen('FORM', { title: 'About you', terminal: true }, (s) => {
    s.form('form', (f) => {
      f.textInput('name', 'Your name', { required: true });
      f.dropdown('channel', 'Channel', [{ id: 'wa', title: 'WhatsApp' }]);
      f.footerComplete('Submit', { name: '${form.name}', channel: '${form.channel}' });
    });
  })
  .build();
```

## Sending + receiving

`POST .../send` dispatches through the channel plugin (`content.type: 'flow'`)
and returns `{ messageId, flowToken }`. The token is echoed back verbatim in
the completion webhook — persist it to correlate. When omitted, omni generates
a **structured token** `omni.<flowId>.<uuid>` (this is how the data endpoint
knows which flow it is serving — Meta's decrypted payload has no flow id).

Completion arrives as a normal inbound message with
`interactive.type: 'nfm_reply'`; the answers are in
`nfm_reply.response_json` (preserved in `rawPayload`, surfaced to the timeline
as text). Multi-select fields arrive as arrays, OptIn as boolean, DatePicker
as `YYYY-MM-DD`.

## Dynamic flows (data_exchange)

Setup, once per instance:

1. Set `META_FLOWS_PUBLIC_BASE_URL` (public HTTPS base, e.g. the ngrok URL in
   dev). The data endpoint is
   `POST {base}/api/v2/channels/whatsapp-cloud/flows/data/:instanceId`
   (auth-exempt; authenticated by Meta's HMAC signature + the fact that only
   the registered key can decrypt).
2. `POST .../whatsapp-flows/keys` — generates a 2048-bit RSA keypair, uploads
   the public half to Meta (`whatsapp_business_encryption`), stores the
   private half sealed (`whatsapp_flow_keys` table). POST again to rotate.
   `GET .../keys` reports Meta's `signature_status` — **MISMATCH means Meta
   encrypts with a key you no longer hold → endless 421s → rotate.**
3. Create the flow with `dynamic: true` (Flow JSON must carry
   `data_api_version: '3.0'`; screens submitted with `footerDataExchange`).
4. Register a resolver (in-process — must answer within ~8s):

```typescript
import plugin from '@omni/channel-whatsapp-cloud';

plugin.flowResolvers.register('<flowId>', {
  resolve: async ({ action, screen, data, flowToken }) => {
    if (action === 'INIT') return { screen: 'STEP_1', data: { options: [...] } };
    if (screen === 'STEP_1') return { screen: 'STEP_2', data: { summary: ... } };
    return {
      screen: 'SUCCESS',
      data: { extension_message_response: { params: { flow_token: flowToken, outcome: 'done' } } },
    };
  },
});
```

`registerInstanceDefault(instanceId, resolver)` catches flows sent with
caller-supplied (opaque) tokens. Send dynamic flows with
`flowAction: 'data_exchange'`.

Every endpoint hit (except pings) also publishes a **`flow.data_exchange`**
event (instanceId, flowId, flowToken, action, screen, data, responseScreen,
durationMs) for observability/async consumers.

### Endpoint status codes (Meta contract)

| Code | Meaning | Client behavior |
|---|---|---|
| 200 | Encrypted next-screen response | renders screen |
| 404 | Unknown instance in URL | generic error |
| 421 | Can't decrypt (missing/rotated key) | re-fetches public key, retries |
| 427 | Bad/absent flow token | tells user to re-open the flow |
| 432 | HMAC signature verification failed | drops request |

Resolver errors/timeouts degrade to an in-screen `error_message` snackbar —
the endpoint never hangs and never 5xxs for resolver failures.

## Key files

| Piece | Path |
|---|---|
| Local Flow JSON validator | `packages/core/src/schemas/whatsapp-flows.ts` |
| Management routes | `packages/api/src/routes/v2/whatsapp-flows.ts` |
| Public data endpoint mount | `packages/api/src/app.ts` (flows/data) |
| Crypto (RSA-OAEP + AES-GCM) | `packages/channel-whatsapp-cloud/src/utils/flow-crypto.ts` |
| Endpoint handler | `packages/channel-whatsapp-cloud/src/handlers/flow-data.ts` |
| Resolver registry + tokens | `packages/channel-whatsapp-cloud/src/flows/resolver.ts` |
| Flow sender | `packages/channel-whatsapp-cloud/src/senders/flow.ts` |
| Graph API client (flows section) | `packages/channel-whatsapp-cloud/src/client.ts` |
| SDK builder | `packages/sdk/src/flow-builder.ts` |
| Key storage | `packages/db/src/schema.ts` (`whatsapp_flow_keys`) |
