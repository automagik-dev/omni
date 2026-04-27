# Channel: Microsoft Teams (`@omni/channel-teams`)

> Plugin reference for the Microsoft Teams channel. Covers the platform decision,
> auth/onboarding, runtime configuration, and the inbound/outbound mapping that
> the plugin uses on top of `@omni/channel-sdk`.
>
> The locked design rationale lives in
> `.genie/brainstorms/teams-channel/DESIGN.md`. This doc is the operator-facing
> companion: how to install the bot, what to put on `InstanceConfig`, and what
> to expect at runtime.

---

## 1. Platform surface

| Choice | Verdict | Why |
|--------|---------|-----|
| **Microsoft Bot Framework + Azure Bot Service** | ✅ chosen | Official messaging surface for Teams. Handles 1:1 chats, group chats, channel posts, threads (replies), reactions, mentions, file uploads, typing indicators, and adaptive cards under one Activity model. Per-tenant `MicrosoftAppId` + secret maps cleanly onto omni's per-instance credential model. |
| Microsoft Graph API | ❌ rejected for v1 | Tenant-wide read surface; needs admin consent and is closer to a sync fabric than a bot. Out of scope per WISH ("Tenant-wide message sync via Graph API is OUT of v1"). |
| Incoming/Outgoing Webhooks | ❌ rejected | One-way and single-channel; cannot DM, cannot react, cannot upload files. Insufficient for the omni contract. |
| Teams Toolkit / App SSO | ❌ rejected | Useful for app install UX but not the messaging core. Out of scope. |

**Result:** the plugin uses the `botbuilder` + `botframework-connector` stack from
the official Microsoft Bot Framework SDK for Node.

## 2. Auth + onboarding (per-tenant)

omni's multi-tenant model maps to Teams as **one bot registration per tenant**:

1. Operator registers an Azure Bot resource (or imports an existing one).
2. Operator captures `MicrosoftAppId`, `MicrosoftAppPassword`, and the Azure tenant ID.
3. Operator creates an omni `Instance` of type `teams` and stores those values on
   `InstanceConfig.config`:
   ```jsonc
   {
     "microsoftAppId": "<guid>",
     "microsoftAppPassword": "<secret>",
     "microsoftAppType": "MultiTenant",          // or "SingleTenant"
     "microsoftAppTenantId": "<azure-tenant-id>" // required when SingleTenant / MSI
   }
   ```
4. Operator points the Azure Bot **messaging endpoint** at
   `${WEBHOOK_BASE_URL}/api/v2/channels/teams/<instance-id>/webhook` (matches the telegram +
   gupshup webhook routing pattern omni already runs).
5. Operator side-loads / publishes the Teams app manifest into the tenant. The
   plugin's `manifest.ts` exposes `buildTeamsManifest(instance)` so operators
   can scaffold the JSON without hand-authoring it.
6. On first inbound activity per conversation, the plugin captures
   `activity.serviceUrl` and trusts it via `MicrosoftAppCredentials.trustServiceUrl()`
   so it can post replies back through the Bot Connector.

**Connect-time validation:** `connect()` constructs a `BotFrameworkAdapter`
(or `CloudAdapter` for the v4 stack) and performs a lightweight token
acquisition against the Bot Framework auth endpoint. A failure surfaces as
`TeamsError(AUTH_FAILED)` so the API can mark the instance as `ERROR` instead
of silently accepting bad credentials (mirrors the `channel-gupshup` taxonomy).

## 3. Capabilities matrix

| Flag | Teams declared | Notes |
|------|:--:|------|
| `canSendText` | `true` | `MessageFactory.text()` |
| `canSendMedia` | `true` | Image/audio/video/document via `attachments[]` (`contentUrl` or hosted upload) |
| `canSendReaction` | `false` | Bot Framework accepts the activity but Teams does not render bot-authored reactions; outbound reactions need Microsoft Graph (deferred) |
| `canSendTyping` | `true` | `typing` activity |
| `canReceiveReadReceipts` | `false` | Bot Framework does not surface read receipts to bots |
| `canReceiveDeliveryReceipts` | `false` | Connector confirms acceptance, not user-side delivery |
| `canEditMessage` | `false` | `tools.editMessage` is a stub in v1; Bot Framework `updateActivity()` plumbing lands in a follow-up wish |
| `canDeleteMessage` | `false` | `tools.deleteMessage` is a stub in v1; Bot Framework `deleteActivity()` plumbing lands in a follow-up wish |
| `canReplyToMessage` | `true` | Channel posts → `replyToId`; threads modeled via the conversation's `topicId` |
| `canForwardMessage` | `false` | No first-class forward primitive in Teams; out of scope |
| `canSendContact` | `false` | Adaptive Card workaround only — deferred |
| `canSendLocation` | `false` | Same as above — deferred |
| `canSendSticker` | `false` | Stickers map to images; not promoted as a first-class type |
| `canHandleGroups` | `true` | `conversation.conversationType === 'groupChat'` |
| `canHandleBroadcast` | `false` | No broadcast primitive |
| `canHandleDMs` | `true` | `conversation.conversationType === 'personal'` |
| `canHandleThreads` | `true` | Channel replies via `replyToId` + thread cache |
| `canStreamResponse` | `false` (v1) | Bot Framework supports streaming via `updateActivity`, but the v1 plugin keeps a single final message — gated on follow-up wish |
| `maxMessageLength` | `28000` | Bot Framework cap; Teams clients further truncate the visible portion at ~4,000 chars (the plugin chunks accordingly in `markdown.ts`) |
| `maxFileSize` | `4194304` (4 MiB) | Bot Framework attachment cap for proactive uploads; Graph-backed uploads are larger but require admin consent (out of scope for v1) |

The full canonical declaration lives in `packages/channel-teams/src/capabilities.ts`
(`TEAMS_CAPABILITIES`). This table is the operator-facing summary; if they
disagree the source-of-truth is the constant.

## 4. Inbound mapping (Teams Activity → `IncomingMessage`)

| Teams field | omni field | Notes |
|-------------|------------|-------|
| `activity.id` | `messageId` | Used as the dedupe key via `createInboundDedupeCache` |
| `activity.from.aadObjectId` (fallback `activity.from.id`) | `sender.platformUserId` | AAD object ID is stable across tenants; bot framework `id` is per-conversation |
| `activity.from.name` | `sender.displayName` | |
| `activity.text` | `text` | Sanitized via `sanitizeMessage` before publish |
| `activity.entities[].mentions` | `mentions` | Maps each `Mention` entity (text + mentioned.id/name) |
| `activity.attachments` | `media[]` | Each attachment fetched via `createDownloadGuard` (size + MIME enforcement); content URLs require the bot's bearer token |
| `activity.conversation.conversationType` | `chat.kind` | `'personal'` → DM, `'groupChat'` → group, `'channel'` → team channel |
| `activity.conversation.id` | `chat.platformChatId` | |
| `activity.channelData.team.id` | `chat.workspaceId` | Set when posting in a Teams channel |
| `activity.replyToId` (or `channelData.threadId`) | `thread.platformThreadId` | Threaded replies; cached via `createThreadCache` so `chat -> thread` lookups stay O(1) |
| `activity.type === 'messageReaction'` | reaction event | Routed through the SDK reaction-ack helper |
| `activity.value` (when type=invoke / cardAction) | structured payload | Reserved for future adaptive-card actions; recorded but not promoted in v1 |

Inbound timing follows the SDK convention: `captureInboundTimings()` builds T0/T1
when the activity arrives at the webhook handler, and `captureT2()` is called
right after `emitMessageReceived()` returns.

## 5. Outbound mapping (`OutgoingMessage` → Teams Activity)

| omni payload | Teams activity | Sender |
|--------------|----------------|--------|
| `{ type: 'text' }` | `MessageFactory.text(content)` | `senders/text.ts` |
| `{ type: 'media', mediaType: 'image' \| 'audio' \| 'video' }` | attachment with the matching MIME (inline bytes ≤ 4 MiB) | `senders/media.ts` |
| `{ type: 'media', mediaType: 'document' }` | hyperlink card pointing at the public `mediaUrl` (Teams file UPLOAD into a channel needs FileConsentCard or Microsoft Graph + SharePoint — not implemented in v1) | `senders/media.ts` |
| `{ type: 'reaction', emoji }` | `messageReaction` activity (`reactionsAdded` / `reactionsRemoved`) | `senders/reaction.ts` |
| `{ type: 'typing' }` | `Activity.typing` | `senders/typing.ts` |
| `replyTo` set | `replyToId` populated on the outgoing activity | shared by all senders |

Each sender records `captureT10` immediately before the platform call and
`captureT11` once the connector confirms the activity ID. Failures throw
`TeamsError(SEND_FAILED, ...)` and the plugin emits `emitMessageFailed`.

## 6. Webhook + adapter wiring

The plugin uses the same pattern as `channel-telegram` and `channel-gupshup`:

```ts
// pseudo-code from src/connection/adapter.ts
const adapter = new CloudAdapter(authConfig);
adapter.onTurnError = (context, error) => this.handleTurnError(instanceId, context, error);

await pluginContext.webhooks.register({
  path: `/api/v2/channels/teams/${instanceId}/webhook`,
  handler: async (req, res) => {
    await adapter.process(req, res, (turnContext) => this.processActivity(instanceId, turnContext));
  },
});
```

If `pluginContext.webhooks` is not yet exposed by the SDK, the plugin escalates
back to the orchestrator (per WISH "SDK gaps: escalate, don't extend silently")
rather than attaching to the host HTTP server directly.

## 7. Reliability utilities adopted

The plugin honors the SDK contract enforced by `compliance.test.ts`:

- `createInboundDedupeCache` — keyed on `activity.id`; suppresses retries from
  Bot Framework's at-least-once delivery.
- `createDownloadGuard` — wraps every attachment fetch (size cap + MIME allow-list
  from `TEAMS_CAPABILITIES.supportedMediaTypes`).
- `sanitizeMessage` — applied to inbound `activity.text` before emission.
- `createThreadCache` — bridges `channelData.threadId` ↔ `activity.replyToId`.
- `reaction-ack` helper — used by inbound reaction handler.
- `captureT10` / `captureT11` / `captureInboundTimings` / `captureT2` — full
  T-checkpoint coverage.

## 8. Errors

`TeamsError` extends `@omni/core`'s `ChannelError`. Codes:

| Code | When |
|------|------|
| `TEAMS_AUTH_FAILED` | `connect()` cannot acquire a Bot Framework token |
| `TEAMS_INVALID_CREDENTIALS` | `InstanceConfig` failed Zod validation at `connect()` time (missing/empty appId/appPassword) |
| `TEAMS_NOT_CONNECTED` | `sendMessage()` invoked before `connect()` (or after `disconnect()`) |
| `TEAMS_SEND_FAILED` | Connector returned a non-2xx; original status + payload in `cause` |
| `TEAMS_RATE_LIMITED` | Connector returned `429`; backoff handled by the SDK retry helper |
| `TEAMS_ATTACHMENT_FAILED` | Outbound attachment upload failed, or `createDownloadGuard` rejected an inbound attachment (size/MIME) |
| `TEAMS_WEBHOOK_INVALID` | Inbound webhook payload could not be parsed as a Bot Framework activity |
| `TEAMS_DM_REJECTED` | DM policy denied a 1:1 chat (e.g. user not on `dmAllowlist` when policy is `pairing`) |
| `TEAMS_CONNECTION_FAILED` | Adapter setup failed (network, missing dependency, etc.) |
| `TEAMS_UNSUPPORTED_ACTIVITY` | Activity type the plugin does not yet handle (recorded for future work) |

## 9. Quick start

```bash
# 1. Install (already in workspace)
bun install

# 2. Register an Azure Bot:
#    https://learn.microsoft.com/en-us/azure/bot-service/abs-quickstart
#    Capture App ID, generate a client secret, note the Azure tenant ID.

# 3. Create an omni instance
omni instance create \
  --type teams \
  --name "acme-teams" \
  --config '{"microsoftAppId":"...","microsoftAppPassword":"...","microsoftAppType":"MultiTenant"}'

# 4. Point the Azure Bot messaging endpoint at:
#    https://<your-omni-host>/api/v2/channels/teams/<instance-id>/webhook

# 5. Side-load the manifest:
omni teams manifest export <instance-id> > teams-app.zip
# Upload via Teams Admin Center -> Manage apps -> Upload custom app

# 6. Verify
omni instance health <instance-id>
# expected: { status: 'CONNECTED' }
```

## 10. Known limitations (v1)

- **Adaptive Cards** — only minimal "Hero card" attachments wired in v1; rich
  adaptive card builders are deferred to a follow-up wish.
- **Streaming responses** — `canStreamResponse: false` for v1. Bot Framework
  supports `updateActivity()`, but the streaming sender will land in a
  follow-up wish so we can model token throttling identically across channels.
- **Tenant-wide message sync (Graph API)** — out of scope. The bot only sees
  conversations it is invited to.
- **Read receipts** — Teams does not surface read receipts to bots.

## 11. Reference

- `packages/channel-teams/src/` — implementation
- `.genie/brainstorms/teams-channel/DESIGN.md` — design decisions
- `.genie/wishes/teams-channel/WISH.md` — execution plan
- Microsoft Bot Framework SDK (Node):
  https://learn.microsoft.com/en-us/azure/bot-service/?view=azure-bot-service-4.0
- Teams platform docs:
  https://learn.microsoft.com/en-us/microsoftteams/platform/
