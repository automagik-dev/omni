# `@omni/channel-teams`

Microsoft Teams channel plugin for Omni v2, built on the Bot Framework
Connector REST protocol + AAD client-credentials OAuth flow.

## Quick start

1. **Register an Azure Bot.** Capture `MicrosoftAppId`, generate a client
   secret, and note the Microsoft Entra tenant ID.
   See https://learn.microsoft.com/en-us/azure/bot-service/abs-quickstart
2. **Create an Omni instance** with type `teams` and store the credentials on
   `InstanceConfig.config`:
   ```jsonc
   {
     "appId": "<guid>",
     "appPassword": "<secret>",
     "appType": "MultiTenant",       // or "SingleTenant"
     "tenantId": "<azure-tenant-id>" // required for SingleTenant
   }
   ```
3. **Point the Bot's messaging endpoint** at
   `https://<your-omni-host>/webhooks/teams/<instance-id>` (matches the
   telegram + gupshup pattern).
4. **Side-load the Teams app manifest** (use `buildTeamsManifest({ botId })`
   from this package to scaffold).
5. **Verify** with `omni instance health <instance-id>` — expect
   `{ status: 'CONNECTED' }`.

For the full architecture / mapping reference, see
[`docs/channel-parity/teams.md`](../../docs/channel-parity/teams.md).
For the locked design rationale (Bot Framework over Graph API, capability
matrix, deferred surfaces) see
[`.genie/brainstorms/teams-channel/DESIGN.md`](../../.genie/brainstorms/teams-channel/DESIGN.md).

## Layout

```
src/
├── capabilities.ts       # TEAMS_CAPABILITIES declaration
├── connection/           # BotFrameworkClient + AAD OAuth helpers
├── handlers/             # Inbound activity → IncomingMessage parsing
├── senders/              # Outbound text / media / reaction / typing
├── components/           # (reserved for future Adaptive Card builders)
├── config/               # (reserved for Zod config schema)
├── dm-policy.ts          # DM accept/reject policy (open / pairing / closed)
├── manifest.ts           # buildTeamsManifest() — Teams app manifest builder
├── markdown.ts           # markdownToTeams() + chunkMessage()
├── plugin.ts             # TeamsPlugin (BaseChannelPlugin subclass)
├── tools.ts              # Agent-callable tools (addReaction, editMessage, …)
├── types.ts              # TeamsConfig, TeamsError, TeamsErrorCode
└── __tests__/            # Unit tests (capabilities, dm-policy, markdown,
                          #             manifest, types, auth, client)
```

## Capability matrix

The full matrix lives in `src/capabilities.ts`. v1 enables:

- text, media (image/audio/video/document), reactions, typing
- per-tenant 1:1 chats, group chats, channel posts with thread replies
- edit / delete via `updateActivity` / `deleteActivity`

Streaming responses, contact / location / sticker types, message forwarding,
broadcast and Adaptive Card *outbound* are deferred.

## Environment variables

The plugin is per-tenant; credentials live on `InstanceConfig.config`. The
`.env.example` documents two optional global runtime overrides:

| Variable | Default | Wired into |
|----------|---------|------------|
| `TEAMS_REQUEST_TIMEOUT_MS` | `15000` | `acquireAccessToken` + `BotFrameworkClient.{sendActivity,replyToActivity}` (per-request `AbortSignal.timeout`) |
| `TEAMS_DOWNLOAD_MAX_BYTES` | `104857600` (100 MiB) | `createDownloadGuard` for inbound attachment downloads |

`serviceUrl` is captured per-conversation on the first inbound activity (Bot
Framework "trust on first use"); there is no global default service URL.

## Running tests

```bash
bun test packages/channel-teams
make typecheck
make lint
```

The plugin is included in the SDK compliance test suite at
`packages/channel-sdk/src/__tests__/compliance.test.ts` — it is exercised
alongside Slack, Discord, Telegram, WhatsApp, and Twilio WhatsApp.
