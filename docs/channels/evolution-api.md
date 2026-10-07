# Evolution API adapter — first implementation

The `evolution-api` channel connects an **existing Evolution API v2 WhatsApp/Baileys instance** to Omni. It uses the same channel SDK, instance lifecycle, tenant credential sealing, ingress claims, and event pipeline as the Z-API adapters.

## Configuration

The operator must approve the Evolution HTTPS origin on the Omni server:

```sh
OMNI_EVOLUTION_ALLOWED_ORIGINS=https://evolution.example.com
```

Multiple origins can be comma-separated. Matching is exact, with no trailing slash in the allowlist. Unapproved origins fail before any request. Redirects are refused and API keys are sent only in the `apikey` header. Paths, URL credentials, queries and fragments are rejected in `baseUrl`. HTTP and private deployments without TLS are not supported in this first version.

Save an access-restricted JSON file:

```json
{
  "baseUrl": "https://evolution.example.com",
  "instanceName": "existing-instance",
  "apiKey": "replace-with-instance-api-key-at-least-16-characters",
  "webhookToken": "replace-with-independent-random-token-at-least-32-characters"
}
```

```sh
omni instances create --name evolution --channel evolution-api --evolution-config-file ./evolution.json
omni instances connect INSTANCE_UUID --evolution-config-file ./evolution.json
```

API create accepts the same object as `evolutionConfig`; connect can reuse stored credentials or rotate the complete object. PATCH can replace the object. The configuration is write-only in API responses. `apiKey` and `webhookToken` are sealed using the existing persisted-tenant/master-key contract when enabled. Apply additive migration `0081_instances_evolution_config` through the normal Omni release process. This implementation does not apply migrations or contact a live server.

The UI includes an Evolution API option with these fields and QR pairing. Startup reconnect and local restart use stored configuration. Local disconnect/shutdown detach the binding; they do not log out, delete, create, or reconfigure a remote Evolution instance.

## Webhook provisioning

Configure the existing instance's webhook in Evolution, using its `/webhook/set/{instance}` endpoint:

```json
{
  "webhook": {
    "enabled": true,
    "url": "https://omni.example.com/api/v2/channels/evolution-api/INSTANCE_UUID/webhook",
    "byEvents": false,
    "base64": false,
    "headers": {
      "x-webhook-token": "same-independent-token-as-evolutionConfig.webhookToken"
    },
    "events": [
      "QRCODE_UPDATED",
      "CONNECTION_UPDATE",
      "MESSAGES_UPSERT",
      "MESSAGES_UPDATE",
      "SEND_MESSAGE"
    ]
  }
}
```

Webhook provisioning remains manual to avoid overwriting another consumer's callback. The adapter requires the independent header token and an exact provider-instance match. It bounds payloads to 2 MiB. It acknowledges message events only after the Omni event publication succeeds; publication failures return 503 and release ingress claims for retry. Own-message echoes use `message.sent` claims instead of triggering received-message automations. Provider envelope fields such as `apikey`, destination and server URL are excluded from persisted message payloads.

## Supported scope

- Send text, images, audio, video, documents, stickers, contacts and locations. Media sending requires a public HTTPS URL; audio uses the general media endpoint, not voice-note conversion.
- Receive text (including common Baileys wrappers), media metadata and public `data.mediaUrl` attachments supplied by Evolution/S3.
- Maintain QR/connection state and translate provider `DELIVERY_ACK`, `READ`, `PLAYED`, and `ERROR` into Omni delivery/read/failure facts. `SERVER_ACK` is not recipient delivery.
- Preserve group participants and LID identities; normalize phone/device JIDs.
- Network ambiguity, invalid send responses, server errors, and publication failure after provider acceptance do not invite automatic duplicate sends. Explicit HTTP 429 is retryable.

## Follow-up work

History import/backfill, quoted sends, reactions, read commands, typing, message edits/deletes, polls, buttons/lists and Meta templates are not implemented. Capabilities stay conservative. `MESSAGES_SET` is ignored rather than replayed as realtime agent input. Unsupported incoming content is preserved as unknown. Encrypted Baileys attachment URLs are not exposed as usable media: without a public `mediaUrl`, only metadata is ingested; authenticated media retrieval/base64 materialization needs a subsequent implementation.

No live Evolution compatibility test has run. Before rollout, validate against the exact deployed Evolution version with disposable instances and test webhook provisioning, reconnect, media storage and retries.

## Upstream contract references

Inspected on 2026-10-06:

- [Evolution send routes](https://github.com/EvolutionAPI/evolution-api/blob/main/src/api/routes/sendMessage.router.ts)
- [Evolution send DTOs](https://github.com/EvolutionAPI/evolution-api/blob/main/src/api/dto/sendMessage.dto.ts)
- [Evolution webhook controller](https://github.com/EvolutionAPI/evolution-api/blob/main/src/api/integrations/event/webhook/webhook.controller.ts)
- [Evolution Baileys event mapping](https://github.com/EvolutionAPI/evolution-api/blob/main/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts)
