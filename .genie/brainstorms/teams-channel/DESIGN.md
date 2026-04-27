# DESIGN: teams-channel

**Status:** Locked
**Owner:** Group 1 (cli)
**Date:** 2026-04-27
**Inputs:** `DRAFT.md`, `WISH.md`, `packages/channel-sdk/src/`, `packages/channel-slack/src/`, `packages/channel-telegram/src/`, `packages/channel-gupshup/src/`, `packages/api/src/app.ts`

This document crystallises Phase 1 of the brainstorm into the hard decisions Group 2+ will scaffold against. It has two halves:

1. **Abstraction reference outline** — the shape every channel plugin (and therefore Teams) MUST implement against `@omni/channel-sdk`. Treat this as the canonical contract until promoted to `packages/channel-sdk/README.md` (see §10).
2. **Teams platform decisions** — surface choice, auth/onboarding, in/out mappings, capability matrix, deps, webhook ingress.

---

## 1. Abstraction Reference Outline

The contract a Teams plugin (or any other) must satisfy. All paths below are inside `packages/channel-sdk/src/`.

### 1.1 Identity & Registration

A plugin is a default-exported instance of a `BaseChannelPlugin` subclass. The `discovery/scanner.ts` walks the `packages/` directory for any directory whose name starts with `channel-` (excluding `channel-sdk`) and `discovery/loader.ts` imports `<package>/src/index.ts`, accepting `default`, `plugin`, or `Plugin` exports. Therefore Teams MUST:

- live at `packages/channel-teams/`
- export `default new TeamsPlugin()` from `packages/channel-teams/src/index.ts`
- declare a `package.json` with name `@omni/channel-teams`
- pass `validatePluginInterface()` (id, name, version, capabilities, lifecycle methods)

`ChannelType` is currently a closed string-union in `@omni/core/types/channel.ts:5–16`:

```ts
export const CHANNEL_TYPES = [
  'whatsapp-baileys', 'whatsapp-cloud', 'discord', 'slack',
  'telegram', 'a2a', 'gupshup', 'twilio-whatsapp', 'internal',
] as const;
```

> **SDK touchpoint (NOT a rework):** Group 2 must add `'teams'` to `CHANNEL_TYPES`. This is an additive enum extension — every previous channel did the same (see `gupshup`, `twilio-whatsapp`). It does not change the `BaseChannelPlugin` shape and therefore does NOT count as the "SDK rework" the wish forbids. If you discover any abstraction-level gap that requires changing class signatures or helper APIs, **stop and escalate**.

### 1.2 Lifecycle Contract (`BaseChannelPlugin`)

Source: `packages/channel-sdk/src/base/BaseChannelPlugin.ts`.

| Member | Required | Purpose |
|---|---|---|
| `readonly id: ChannelType` | yes | matches the enum above; selector for `channelRegistry.get(id)` |
| `readonly name: string` | yes | human display ("Microsoft Teams") |
| `readonly version: string` | yes | semver of the plugin package |
| `readonly capabilities: ChannelCapabilities` | yes | static capability matrix (§8 below) |
| `initialize(ctx: PluginContext)` | inherited | wires `eventBus`, `logger`, `storage`, `config`, `db`. Override `onInitialize` for plugin-local setup. **Do not connect external services here.** |
| `connect(instanceId, InstanceConfig)` | abstract | per-tenant connect. Must call `emitInstanceConnected` (or `emitQrCode`/`emitInstanceDisconnected` on failure paths). Must throw a typed `ChannelError` subclass on auth failures so the orchestrator can render a useful message. |
| `disconnect(instanceId)` | abstract | release resources, emit `instance.disconnected`. |
| `sendMessage(instanceId, OutgoingMessage)` | abstract | emit `message.sent` on success, `message.failed` on failure; return `SendResult` with `messageId` + `timestamp`. |
| `getStatus(instanceId)` | inherited | optional override (Telegram overrides it to detect zombie pollers). |
| `getConnectedInstances()` | inherited | reads from internal `InstanceManager`. |
| `destroy()` | inherited | calls `disconnect` for every tracked instance, then `onDestroy()`. |
| `getHealth()` | inherited | aggregates `getHealthChecks()`; default check covers connected count vs configured count. |
| `handleWebhook?(req: Request) → Response` | optional | implement when the channel ingests via HTTP. The API mounts these (see §9). |

### 1.3 Optional Surface (per capability)

These methods exist on the `ChannelPlugin` interface (`packages/channel-sdk/src/types/plugin.ts`) and are gated by capability flags:

- `createStreamSender?` — if `canStreamResponse`
- `sendTyping?` — if `canSendTyping` (consumed by issue #404 follow-up runtime)
- `markAsRead?` / `markChatAsRead?` — if `canReceiveReadReceipts`
- `getProfile?`, `fetchUserProfile?`, `fetchContacts?`, `fetchGroups?`, `fetchGroupMembers?` — profile/contacts sync
- `fetchHistory?(instanceId, FetchHistoryOptions) → FetchHistoryResult` — required for per-thread sessions
- `react?` / `unreact?` — if `canSendReaction`

### 1.4 Default Capabilities

Source: `packages/channel-sdk/src/types/capabilities.ts`. `DEFAULT_CAPABILITIES` is conservative (text only, no media, no rich content, no limits). Every plugin spreads it and overrides only what the platform actually supports. The matrix surfaces 5 categories:

1. **Core messaging** — `canSendText/Media/Reaction/Typing`, read/delivery receipts, edit/delete/reply/forward.
2. **Rich content** — contacts, location, sticker, embeds, polls, buttons, select menus, modals, slash commands, context menus, DMs, threads, webhooks, voice.
3. **Streaming** — `canStreamResponse`.
4. **Window constraints** — `hasMessagingWindow` + `messagingWindowMs` (Meta-style 24h).
5. **Limits** — `maxMessageLength`, `supportedMediaTypes`, `maxFileSize`, button/row/select limits.

### 1.5 Event Emitters (provided by `BaseChannelPlugin`)

Subclasses MUST publish via these helpers — they generate correlation IDs, set hierarchical NATS subjects, record instance activity, and log at debug:

| Helper | Subject | Notes |
|---|---|---|
| `emitMessageReceived(EmitMessageReceivedParams)` | `message.received` | inbound text/media/reaction text-payload. Carries `timings` + `isHistorySync` for journey + ingest mode. Returns correlationId for `captureT2`. |
| `emitMessageSent(EmitMessageSentParams)` | `message.sent` | confirms outbound sent to platform. |
| `emitMessageFailed(EmitMessageFailedParams)` | `message.failed` | logs `warn` automatically. Use when send throws. |
| `emitMessageDelivered/Read` | `message.delivered`/`message.read` | gated by capability flags. |
| `emitReactionReceived/Removed` | `reaction.received`/`reaction.removed` | |
| `emitButtonClick` | `message.button_click` | for interactive components. |
| `emitPoll` / `emitPollVote` | `message.poll` / `message.poll_vote` | |
| `emitInstanceConnected/Disconnected/QrCode` | `instance.connected`/`disconnected`/`qr_code` | |
| `emitMediaReceived` | `media.received` | for follow-up media processing pipelines. |

Param shapes are in `packages/channel-sdk/src/helpers/events.ts`.

### 1.6 SDK Helpers (consumed via `@omni/channel-sdk`)

- `createInboundDedupeCache()` → `DedupeCache` — per-instance webhook dedupe (gupshup/telegram both do this).
- `createThreadStarterCache()` — caches thread-root resolutions.
- `sanitizeMessage`, `sanitizeOutboundText`, `isValidInstanceId` — input/output hygiene.
- `createDownloadGuard(...)` → `DownloadGuard` — bounded media downloads with size cap.
- `buildSubject`, `parseSubject`, `eventTypeToPattern`, `matchesPattern` — NATS subject helpers re-exported from `@omni/core/events/nats`.
- Reaction-ack helpers (`reaction-ack.ts`) — implement the 👀→✅ visual feedback cycle.

### 1.7 `InstanceConfig`

Source: `packages/channel-sdk/src/types/instance.ts`.

```ts
interface InstanceConfig {
  instanceId: string;
  credentials: Record<string, unknown>;
  options?: Record<string, unknown>;
  webhookUrl?: string;
}
```

Both `credentials` and `options` are bag-of-strings — convention across plugins is to read primary secrets from `credentials` first, fall back to `options`. Webhook URLs (when the plugin needs to register a callback URL with the platform) come from either `webhookUrl` or `options.webhookUrl`. Per-tenant: the orchestrator passes a fresh `InstanceConfig` per `connect(instanceId, ...)` call.

### 1.8 Manifest & Auto-Discovery

There is **no separate `manifest.ts` contract enforced by the SDK**. The slack package uses `manifest.ts` to **build a Slack-app manifest JSON** (OAuth scopes, event subscriptions) — it is plugin-internal, not consumed by the registry. Discovery is entirely package-name based (§1.1). Therefore Teams `manifest.ts` should follow the same idiom: a builder for the **Teams app manifest JSON** (bot ID, permissions, channels of activity) used by operators when registering the Teams app, not anything the SDK reads.

### 1.9 `sdk-compliance-test-suite` Expectations

Wish: `.genie/wishes/sdk-compliance-test-suite/`. The acceptance criteria for **this** wish (Group 5) say:

> sdk-compliance suite green for `channel-teams`

If the suite is implemented at the time Group 5 runs, opt in by following whatever opt-in mechanism it documents (commonly: import the suite, register the plugin, run it). If the suite isn't yet enforcing plugin acceptance, Group 5 logs the gap in the WISH closeout and proceeds — explicit in the WISH assumptions section.

---

## 2. Teams Platform Decision

### 2.1 Surfaces Surveyed

| Surface | Inbound | Outbound | DMs | Channels | Reactions | Mentions | Files | Auth | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| **Bot Framework + Azure Bot** | activities via webhook (`/api/messages`) | adapter.continueConversation / sendActivity | yes | yes | `messageReaction` activity | yes (Entity[]) | attachment download via Bot Token | `MicrosoftAppId` + `MicrosoftAppPassword` (or MSI/Cert) | **CHOSEN** |
| Microsoft Graph `/teams/.../messages` | polling or change notifications | `POST /chats/{id}/messages` | yes | yes | yes | yes | yes | OAuth user/app token + admin consent | rejected — needs admin consent + RSC; not bot semantics |
| Incoming Webhook | n/a | post to one channel only | no | one fixed channel | no | no | no | URL secret | rejected — one-way, single channel |
| Workflow / Outgoing Webhook | one-channel mention only | n/a | no | one channel | no | yes | no | HMAC | rejected — toy surface |

### 2.2 Decision: Bot Framework + Azure Bot Service

**Justification:**

- **Symmetry with the rest of Omni.** Slack uses Bolt (its bot framework); Telegram uses grammy; Teams uses the Microsoft Bot Framework. Plugin contracts are identical: per-instance bot install, webhook activity intake, conversation reference for outbound.
- **Bot semantics match `BaseChannelPlugin`.** Bot Framework activities map cleanly to omni's `IncomingMessage` / `emitMessageReceived` shape (see §6). Graph would force us to model "tenant-wide read everything" which doesn't fit.
- **No admin consent treadmill.** Bot install is per-team (sideload or admin-approved app catalog) — operators install one bot per tenant, store creds in `InstanceConfig`. Graph requires Azure AD admin consent for every tenant and elevated `ChannelMessage.Read.All` / `Chat.Read.All` scopes — operationally heavy and out of v1 scope per WISH.
- **Reactions, mentions, files are first-class activities.** No need to call Graph for any messaging-loop primitive. (Graph remains a future option for tenant-wide message sync — explicitly OUT of v1 per WISH.)
- **Adapter library is mature on Node.** `botbuilder` v4 is the official SDK; it works under Bun (it is plain Node.js code).

### 2.3 Why Not the Alternatives

- **Graph API only:** would also need a webhook endpoint for change notifications anyway, *and* admin consent, *and* would not give us a clean "send as bot" identity. Net: more complex, less aligned.
- **Webhooks only:** can't send DMs, can't react to messages, single-channel scoped. Useless as a general channel.

### 2.4 Bot Framework Tradeoffs Worth Knowing

- The `botbuilder` SDK is sizeable (`botbuilder`, `botbuilder-core`, `botframework-connector`, `botframework-schema`). Group 2 should pin minor versions to keep bundles stable.
- The "Bot Channels Registration" / "Azure Bot" resource in Azure is mandatory and the friction point. Operator docs (Group 5) must walk through: register Azure Bot → set messaging endpoint → install app to Teams team.
- Inbound activity validation requires `MicrosoftAppCredentials` + JWT validation — `botbuilder`'s `CloudAdapter` does this for us; DO NOT reimplement.

---

## 3. Auth & Onboarding

### 3.1 Per-Tenant Bot

The decision in WISH ("per-tenant install") matches Bot Framework's natural unit of trust:

- One Azure Bot resource per tenant (or one shared bot if the operator runs a multi-tenant Azure AD app). Default to **single-tenant** for v1 — multi-tenant is a follow-up.
- Each `InstanceConfig` represents one team-installed bot.

### 3.2 Credentials on `InstanceConfig`

```ts
interface TeamsConfig {
  // Azure Bot identity
  microsoftAppId: string;            // GUID; required
  microsoftAppPassword?: string;     // client secret (single-tenant or multi-tenant secret); required if SingleTenant/MultiTenant
  microsoftAppTenantId?: string;     // tenant GUID; required for SingleTenant app type
  microsoftAppType?: 'MultiTenant' | 'SingleTenant' | 'UserAssignedMSI';

  // Optional behavior knobs (mirrors slack)
  channelAllowlist?: string[];       // Teams channel IDs (`19:xxxxx@thread.tacv2`)
  channelBlocklist?: string[];
  dmPolicy?: 'open' | 'pairing' | 'closed';
  dmAllowlist?: string[];
  requireMention?: boolean;          // default false in DMs, true in channels
  ackReaction?: string | false;      // emoji name (e.g. 'eyes'); set false to disable
  removeAckAfterReply?: boolean;
  defaultUsername?: string;          // override bot display name on send (rare)
}
```

Read primary fields from `credentials.{microsoftAppId,microsoftAppPassword,microsoftAppTenantId}` first, fall back to `options.*` (matches existing channel-slack/telegram convention).

### 3.3 Onboarding Flow (operator)

1. Operator creates an **Azure Bot** resource (Bot Channels Registration), records `App ID` + `Client Secret`. Selects app type (`SingleTenant` recommended for tenant isolation).
2. Operator sets the **Messaging endpoint** to the omni public URL: `https://<api-host>/api/v2/channels/teams/{instanceId}/webhook` (see §9).
3. Operator enables the **Microsoft Teams channel** in the Azure Bot blade.
4. Operator builds the Teams app manifest (using `manifest.ts` builder from §10 / Group 5) and side-loads it into the team (or publishes via the org app catalog).
5. Operator creates the omni instance via the dashboard / CLI with the credentials + (optional) config knobs from §3.2. The omni `connect()` runs (§3.4).

### 3.4 Connect-Time Validation

Lightweight, no message-send: hit Bot Framework's token endpoint via `MicrosoftAppCredentials.getToken()` (or `ConfidentialClientApplication.acquireTokenByClientCredential` for newer SDKs). On failure, throw `TeamsError(TeamsErrorCode.AUTH_FAILED, ...)`. Document in DESIGN: do **not** attempt a `Get team info` Graph call (out of scope; would force extra perms). Acquiring the token proves the secret + AppId combo is valid.

---

## 4. Webhook Ingress

### 4.1 Existing Pattern in Omni (Authoritative Read)

`packages/api/src/app.ts` mounts plugin webhooks **on the API process itself** before the auth middleware:

- `POST /api/v2/instances/:id/telegram/webhook` — Telegram (line 174)
- `POST /api/v2/channels/gupshup/:instanceId/webhook` — Gupshup (line 218)
- `POST /api/v2/channels/twilio-whatsapp/:instanceId/webhook` — Twilio (line 235)
- `GET /.well-known/agent.json` + `POST /a2a/:instanceId` — A2A (line 138/149)

Every one of these resolves the plugin via `c.get('channelRegistry').get(<id>)` and delegates to `plugin.handleWebhook(c.req.raw)` (Telegram has a small extra path for HMAC verification before delegation). Plugins do NOT stand up their own HTTP listeners.

### 4.2 Decision: Add a Public Route in `packages/api/src/app.ts`

Group 3 will add:

```
POST /api/v2/channels/teams/:instanceId/webhook
```

mounted **before** the protected auth middleware (Bot Framework calls in unauthenticated; the adapter validates JWTs internally). The route will look up `channelRegistry.get('teams')` and call `plugin.handleWebhook(c.req.raw)`. The `TeamsPlugin` will use `botbuilder`'s `CloudAdapter.process(req, res, logic)` — adapt the Hono `Request` to a Bot Framework `WebRequest`/`WebResponse`. Pattern: capture the body, hand both to the adapter, return whatever the adapter wrote.

There is **no SDK gap** here — `handleWebhook?(request: Request): Promise<Response>` is the existing optional method on `ChannelPlugin`. Teams is a fit.

### 4.3 GET path (optional)

The Bot Framework occasionally probes the messaging endpoint with a GET. If we want zero noise, also mount `app.get('/api/v2/channels/teams/:id/webhook', ...)` returning 200. Group 3 may decide.

---

## 5. Inbound: Activity → `IncomingMessage` Mapping

Bot Framework `Activity` types we care about: `message`, `messageReaction`, `messageUpdate`, `messageDelete`, `conversationUpdate` (members added/removed), `typing`. Group 3 implements handlers under `src/handlers/`.

### 5.1 `message` Activity → `emitMessageReceived`

| Source field (Activity) | Maps to (`EmitMessageReceivedParams`) | Notes |
|---|---|---|
| `id` | `externalId` | Teams message GUID |
| `conversation.id` | `chatId` | for channel messages: `19:xxxx@thread.tacv2;messageid=N`. For DM/group: `a:xxxx`. |
| `conversation.conversationType` (`personal`/`groupChat`/`channel`) | `chatName` (when channel: `channelData.team.name` + `channelData.channel.name`) | also used for DM-vs-channel routing |
| `from.id` (`29:xxxx`) | `from` | AAD object id when available via `aadObjectId` |
| `from.name` | `senderName` | |
| `text` | `content.text` (after `removeMentionText` to strip `<at>...</at>`) | use `TurnContext.removeRecipientMention` semantics |
| `attachments[]` | `content.{mediaUrl,mimeType,filename}` (one event per attachment if multiple) | see §5.4 |
| `replyToId` | `replyToId` | |
| `channelData.channel.id` (when conversationType=`channel`) | `threadId` | maps Teams "channel post" thread root |
| `localTimestamp`/`timestamp` | T0 via `captureT0(date.getTime())` | already ms |
| full activity | `rawPayload` | persist for debugging |

### 5.2 DM vs Channel vs Group

- `personal` → DM. Apply `dmPolicy` from §3.2 (mirror slack `dm-policy.ts`).
- `groupChat` → multi-party chat (no Teams "channel"). Treat like a private group.
- `channel` → public channel post. `channelData.team.id` + `channelData.channel.id` available. Threading: a channel post and its replies share `conversation.id`'s root and the reply has `replyToId` set.

### 5.3 Mentions

Bot Framework parses mentions into `entities[]` of type `mention`. Strip the `<at>BotName</at>` from `text` before emit (use `TurnContext.removeRecipientMention(activity)`). If `requireMention === true` (channel context), drop messages where the bot was not mentioned.

### 5.4 Attachments

Teams attachments arrive in two flavors:

- **Inline files** (`contentType: 'application/vnd.microsoft.teams.file.download.info'`): `content.downloadUrl` is a SAS URL; download with `createDownloadGuard` and emit one `media.received` per file plus `message.received` with `content.type` derived from MIME.
- **Card attachments** (Adaptive Cards): out of scope for v1 inbound; log + skip.

Use `download-guard.ts` to bound size (default 25 MB; configurable).

### 5.5 Reactions

`messageReaction` activity carries `reactionsAdded[]` and `reactionsRemoved[]`. Emit `emitReactionReceived` / `emitReactionRemoved` per reaction. The emoji is reported as a name (`like`, `heart`, `laugh`, `surprised`, `sad`, `angry`) — store the name in `emojiName` and the unicode equivalent in `emoji` (mapping table in `senders/reaction.ts`).

### 5.6 Edits / Deletes

`messageUpdate` and `messageDelete` map to omni's content types `edit` and `delete`. v1: emit them but downstream may treat as no-op. Document the limitation in package CLAUDE.md.

### 5.7 Conversation Updates

`conversationUpdate` (membersAdded includes the bot): treat as "bot installed in team" — log + emit nothing yet. Future hook for onboarding messages.

---

## 6. Outbound: `OutgoingMessage` → Activity Mapping

The plugin's `sendMessage(instanceId, OutgoingMessage)` dispatches per `content.type`. Bot Framework requires a stored **conversation reference** (`ConversationReference`) for proactive sends (when not currently inside a `TurnContext`). Group 3/4 maintains a per-instance `Map<chatId, ConversationReference>` populated on every inbound activity, then uses `adapter.continueConversation(reference, async (ctx) => ctx.sendActivity(...))` for outbound.

| `OutgoingMessage.content.type` | Bot Framework call | Notes |
|---|---|---|
| `text` | `MessageFactory.text(text)` then `ctx.sendActivity` | apply `markdown.ts` conversion (see §10) |
| `image` | `MessageFactory.attachment({contentType: mime, contentUrl, name})` | for inline image; if media is a local Buffer use `contentBytes` (base64) |
| `audio`, `video` | same attachment factory with appropriate MIME | Teams supports playback |
| `document` | `MessageFactory.attachment({contentType: 'application/vnd.microsoft.teams.file.download.info', content: {...}, name: filename})` for files via Teams file API; fall back to a plain hyperlink card |
| `sticker` | not supported on Teams; fall back to text "(sticker)" |
| `reaction` | `restClient.conversations.replyToActivity` is not a true reaction. **Teams bots cannot send reactions outbound.** Capability matrix: `canSendReaction: false`. |
| `location` | text card with maps link (Teams has no native location card via bot) |
| `contact` | text card |
| Others (poll, pix, …) | unsupported; log + emit `message.failed` with `errorCode: 'UNSUPPORTED_CONTENT'` |

Adaptive Cards are deferred to a follow-up wish (per WISH.md OUT). v1 outbound = text + media attachments.

`replyTo`: when set and the outbound corresponds to a known channel post root, set `activity.replyToId` for proper threading (and `conversation.id` to the channel-post id). Otherwise it's a flat reply.

`SendResult`:

```ts
return {
  success: true,
  messageId: result.id,            // returned by sendActivity
  timestamp: Date.now(),
};
```

On failure (Bot Framework throws `RestError`), call `emitMessageFailed` with `errorCode: TeamsErrorCode.SEND_FAILED` and `retryable: isRetryableStatus(err.statusCode)` (4xx auth → false; 429/5xx → true).

---

## 7. Capability Matrix (Locked)

```ts
export const TEAMS_CAPABILITIES: ChannelCapabilities = {
  // Core messaging
  canSendText: true,
  canSendMedia: true,
  canSendReaction: false,         // bots cannot react to messages in Teams
  canSendTyping: true,            // adapter.sendActivity({type: 'typing'})
  canReceiveReadReceipts: false,
  canReceiveDeliveryReceipts: false,
  canEditMessage: true,           // updateActivity()
  canDeleteMessage: true,         // deleteActivity()
  canReplyToMessage: true,        // replyToId / channel-post threading
  canForwardMessage: false,

  // Rich content
  canSendContact: false,
  canSendLocation: false,
  canSendSticker: false,
  canHandleGroups: true,          // groupChat conversations
  canHandleBroadcast: false,

  // Rich content (Teams-flavored)
  canSendEmbed: false,            // Adaptive Cards = follow-up wish
  canSendPoll: false,
  canSendButtons: false,          // requires Adaptive Cards — follow-up
  canSendSelectMenu: false,
  canShowModal: false,            // Task modules = follow-up
  canUseSlashCommands: false,     // command extensions = follow-up
  canUseContextMenu: false,
  canHandleDMs: true,             // personal conversations
  canHandleThreads: true,         // channel-post threading
  canCreateWebhooks: false,
  canSendViaWebhook: false,
  canHandleVoice: false,
  canStreamResponse: false,       // v1; later use updateActivity to mimic streaming

  // Limits
  maxMessageLength: 28000,        // Teams hard limit per activity (text)
  supportedMediaTypes: [
    { mimeType: 'image/*',       maxSize: 25 * 1024 * 1024 }, // 25MB attachments
    { mimeType: 'audio/*',       maxSize: 25 * 1024 * 1024 },
    { mimeType: 'video/*',       maxSize: 25 * 1024 * 1024 },
    { mimeType: 'application/*', maxSize: 25 * 1024 * 1024 },
  ],
  maxFileSize: 25 * 1024 * 1024,
};
```

Concrete enough to scaffold from. Anything not in this matrix is OUT for v1.

---

## 8. Required Dependencies

`packages/channel-teams/package.json`:

```jsonc
{
  "dependencies": {
    "@omni/channel-sdk": "workspace:*",
    "@omni/core": "workspace:*",
    "botbuilder": "^4.23.0",
    "botbuilder-core": "^4.23.0",
    "botframework-connector": "^4.23.0",
    "botframework-schema": "^4.23.0"
  }
}
```

Pin to one minor (`^4.23` at time of writing). All four are needed: `botbuilder` re-exports `CloudAdapter`/`MessageFactory`; `botframework-connector` for `MicrosoftAppCredentials`; `botframework-schema` for `Activity` types.

> Verify Bun compatibility on Group 2 install; the libs are pure JS but ship CommonJS entry points. If interop bites, pin via `bunfig.toml` overrides — escalate if it remains broken.

---

## 9. Webhook Route Registration (Group 3 Owns)

Add to `packages/api/src/app.ts` between the existing Twilio (line 235) and gupshup blocks:

```ts
app.post('/api/v2/channels/teams/:instanceId/webhook', async (c) => {
  const channelRegistry = c.get('channelRegistry');
  if (!channelRegistry) return c.json({ error: { code: 'NO_REGISTRY', ... } }, 503);
  const plugin = channelRegistry.get('teams');
  if (!plugin?.handleWebhook) return c.json({ error: { code: 'PLUGIN_NOT_FOUND', ... } }, 503);
  return plugin.handleWebhook(c.req.raw);
});
// Optional GET probe responder
app.get('/api/v2/channels/teams/:instanceId/webhook', (c) => c.text('ok', 200));
```

Pattern matches gupshup line-for-line. Auth-exempt: Bot Framework JWT validation lives inside the adapter.

---

## 10. Abstraction Reference Doc Location

**Decision:** create `packages/channel-sdk/README.md` in **Group 5** (per WISH "optional but preferred"). Rationale:

- It travels with the SDK package — a developer typing `bun add @omni/channel-sdk` lands on it.
- `docs/channel-parity/` is more for cross-channel comparison docs (e.g. an eventual "what does each channel support" matrix), not the SDK contract.
- Group 1 deferring this is fine: §1 of THIS doc is the source-of-truth outline; Group 5 lifts it (with example code) into `packages/channel-sdk/README.md`.

If Group 5 finds the slack/telegram/gupshup docstrings already cover 80% of what a reader needs, downsize the README to "see X for examples; here is the contract" + the §1.2 / §1.4 / §1.5 tables verbatim.

---

## 11. Resolution of `DRAFT.md` Open Questions

| Question | Resolution |
|---|---|
| Where should the abstraction reference live? | `packages/channel-sdk/README.md`, deferred to Group 5. Outline locked here in §1. |
| Does omni already have a unified webhook ingress channels share, or does each plugin stand up its own listener? | **Unified router in `packages/api/src/app.ts`** that delegates to `plugin.handleWebhook(req)`. Plugins do NOT run their own HTTP servers. Teams adopts this pattern. |
| Right Teams auth model — single shared bot or per-tenant? | **Per-tenant**, via per-instance `microsoftAppId` + `microsoftAppPassword` + `microsoftAppTenantId` on `InstanceConfig`. Multi-tenant single-bot is a follow-up. |
| Adaptive Cards in v1? | **No.** Outbound is text + media attachments. Adaptive Cards / task modules / command extensions = future wish. |
| How does omni handle bot mentions vs direct addressing? | Slack does it via `dm-policy.ts` + `requireMention` in instance config. Teams mirrors this 1:1: `dmPolicy`/`dmAllowlist`/`requireMention` knobs in `TeamsConfig`. Mentions are stripped via `TurnContext.removeRecipientMention` before emit. |

---

## 12. Acceptance Checklist (for Group 1 reviewer)

- [x] All `DRAFT.md` open questions resolved (§11).
- [x] Platform surface choice is final and justified (§2).
- [x] Capability matrix is concrete and code-ready (§7).
- [x] Auth model defined with credential field shapes (§3.2).
- [x] Inbound + outbound mappings table-complete (§5–6).
- [x] Webhook ingress decision concrete (§4 + §9).
- [x] Dependency list pinned (§8).
- [x] Abstraction reference doc location decided (§10).
- [x] No silent SDK extension; the only `@omni/core` change (adding `'teams'` to `CHANNEL_TYPES`) is called out and justified (§1.1).

---

## 13. Hand-off Notes for Group 2

- Scaffold `packages/channel-teams/` mirroring `packages/channel-slack/` directory layout.
- Add `'teams'` to `packages/core/src/types/channel.ts` `CHANNEL_TYPES`.
- Use `TEAMS_CAPABILITIES` from §7 verbatim in `capabilities.ts`.
- Use `TeamsConfig` from §3.2 + the error-code class pattern from `channel-slack/src/types.ts:301–349` (extends `ChannelError`, maps to `ERROR_CODES`).
- `manifest.ts` builds the **Teams app manifest JSON** (mirrors `channel-slack/src/manifest.ts` but for Teams), not anything the SDK consumes.
- All other files start as stubs; Groups 3–5 fill them.
