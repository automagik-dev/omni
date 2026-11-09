# @omni/channel-zenvia

WhatsApp channel plugin for **Zenvia** (`https://api.zenvia.com/v2`), an
official Meta BSP with its own API format (not a Cloud API mirror).

## How it maps to the API

- **Outbound** — `POST /v2/channels/whatsapp/messages` with
  `{ from, to, contents: [...] }`. `from` is the instance's sender id; `to`
  is the contact's digits-only number.
- **Inbound** — Zenvia subscriptions (`POST /v2/subscriptions`) deliver JSON
  events to the per-instance webhook. Every event is validated with Zod
  (`src/types.ts`) before it reaches the plugin.
- **Auth** — the static `X-API-TOKEN` header on every call.
- **Normalization** — consumers should not need to know which BSP carried a
  message:
  - the contact profile name is `senderName` (and `rawPayload.pushName`);
  - inbound files surface as `mediaId` and are materialized by
    `downloadInboundMedia`, behind the SDK download guard. Redirects are
    followed by hand (at most 5): every hop must be https to a named host (no
    IP literal, no localhost), and the token goes only to Zenvia hosts and is
    dropped for good once a hop leaves them. The timeout covers the body too;
  - a click-to-WhatsApp ad referral is exposed as `rawPayload.referral` in
    the Meta Cloud API shape (`source_type`, `source_id`, `source_url`,
    `headline`, `body`, `ctwa_clid`);
  - the original Zenvia message stays under `rawPayload.zenvia`.

## Instance config

| Key                     | Required | Notes                                                                                       |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `zenviaApiToken`        | yes      | `X-API-TOKEN` header of the Zenvia API v2. Sealed at rest.                                  |
| `zenviaSenderId`        | yes      | The sender registered at Zenvia (the WhatsApp number).                                      |
| `zenviaSalesApiKey`     | no       | Key of the Zenvia Sales APIs (`api-key` query parameter). **Not** the same token as above. Sealed at rest. |
| `zenviaHandoffGroupId`  | no       | Sales group dedicated to the chatbot. With `zenviaSalesApiKey` it is required, unless `zenviaHandoffRouting` is set; then it is the default group. |
| `zenviaHandoffRouting`  | no       | JSON `{ "field": "<handoffFields key>", "groups": { "<value>": "<groupId>" } }`: the value of that key picks the Sales group (see Routing a handoff to a group). Needs `zenviaSalesApiKey`. |
| `zenviaHandoffUserId`   | no       | A specific agent inside the chosen group.                                                   |
| `zenviaHandoffSolution` | no       | `conversion` \| `zenvia_chat` \| `nlu`. Fallback routing when there is no Sales transfer.     |
| `webhookVerifyToken`    | yes      | Shared secret every webhook POST must carry as `x-webhook-token`. Zenvia signs nothing, so an instance does not connect without it. |

To wire up the webhook, create the subscriptions with that URL. Put the
verify token in the subscription's fixed headers:

```json
{
  "eventType": "MESSAGE",
  "webhook": {
    "url": "{OMNI_BASE_URL}/api/v2/channels/zenvia/{instanceId}/webhook",
    "headers": { "x-webhook-token": "<webhookVerifyToken>" }
  },
  "criteria": { "channel": "whatsapp", "direction": "IN" }
}
```

Create one subscription per event type (`MESSAGE` and `MESSAGE_STATUS`).

The webhook answers 200 to every authenticated event, 401 to a missing or
wrong token and 503 while the instance is not connected (during a restart),
so Zenvia can redeliver. An inbound `MESSAGE` addressed to a different sender
of the same Zenvia account is acknowledged and dropped, so two instances on
one account never answer each other's contacts.

## Handoff

`POST /messages/send/handoff` has two modes, chosen by the instance config:

**Transfer through the Sales API** (`zenviaSalesApiKey` + `zenviaHandoffGroupId`
and/or `zenviaHandoffRouting`). This is the ZCC flow. In order:

1. `GET /api/v1/prospect-by?phoneNumber=` finds the prospect of the contact,
   first with a leading `+` and then digits only (the second try also runs
   when the first format is rejected with a 4xx). No prospect means no
   conversation to transfer, and the handoff fails before anything is sent.
2. `POST /api/v1/prospect/{id}/transfer` moves the prospect to the group, or
   to `zenviaHandoffUserId` inside it. A refusal, or an explicit
   `success: false`, fails the handoff before anything is written or sent,
   so the agent keeps the chat. Any other 2xx, empty body included, counts as
   done.
3. `POST /api/v1/prospect/{id}/interactions` writes a `note` with the context
   the agent needs: `motivoHandoff`, `dadosLead` and every `handoffFields`
   key. It runs after the transfer, so a retried handoff never leaves an
   orphan note; a note that fails is logged and the handoff stands.
4. The farewell text is sent through the API v2 as an ordinary message.
   If only this step fails, the handoff still counts as done, because the
   contact already belongs to a person.

The route's default side effects then run (`agentPaused`, follow-up disarm,
audit row). Requirements on the Zenvia side: the WhatsApp number must have
its destination set to *Atendimento Comercial* and be assigned to a group
created exclusively for the chatbot. On connect the plugin lists the groups
visible to the Sales key and logs a warning when the group is not among them,
when the key is rejected or when the Sales API is down; none of that blocks
the connection, because messaging must not depend on an optional feature.
Setting the Sales key without a group (`zenviaHandoffGroupId` or
`zenviaHandoffRouting`), or a group without the key, leaves the transfer off
(logged) instead of failing the connect.

### What `data.messageId` tells the caller

On `POST /messages/send/handoff` and `POST /messages/send/close-contact`,
`data.messageId == null` means **no phrase reached the contact**. Read it that
way, not as an error:

- **Handoff by transfer, farewell failed.** The transfer already happened, so
  the contact belongs to a person and the call stays a success (201). Only the
  farewell is missing: `messageId` is `null`, the plugin logs an `error` with
  `instanceId` and `errorCode`, and a `message.failed` event is emitted. The
  caller must not resend the handoff; it can tell the contact itself.
- **Handoff by conversation routing, farewell failed.** The farewell is the
  handoff, so this is a failure (502 for a transient cause, see the table).
- **Close contact.** `canCloseContact` is `false`: the route sends nothing to
  Zenvia, applies its side effects and answers `messageId: null`. The caller
  must treat that as a farewell **not sent**.

### Routing a handoff to a group

By default every handoff goes to `zenviaHandoffGroupId`. When the emitter
chooses a queue, `zenviaHandoffRouting` sends each queue to its own Sales
group:

```json
{
  "field": "queue_field",
  "groups": { "queue-a": "group-1", "queue-b": "group-2" }
}
```

- `field` is the key of `handoffFields` that carries the queue. It is plain
  per-instance config: the plugin has no built-in key name.
- The value of `handoffFields[field]` is compared with the keys of `groups`
  after trimming, collapsing inner whitespace and ignoring case, so
  `" Queue-A "` finds `"queue-a"`. Only string values match: a number, an
  object or a missing key never does. Two keys that become equal after that
  normalization are refused as a configuration error.
- No match, a missing key or a value that is not a string: the handoff goes to
  `zenviaHandoffGroupId` and a `warn` log names the key and, for a string, the
  value (nothing else from the lead). Without a default group the handoff is
  refused for good (422, see the table above) before Zenvia is called.
- `zenviaHandoffUserId` is applied inside whichever group is chosen. An agent
  normally belongs to specific groups, so leave it unset when routing to
  several groups: whether Zenvia refuses a user that is not in the target group
  is an open question (below), and a refusal would be a 422.
- The note written to the prospect still carries the queue with the rest of
  `handoffFields`.
- An invalid map (not an object, blank `field`, empty `groups`, a group id that
  is not a non-empty string, unknown keys) is a 400 on `POST` and `PATCH` of
  the instance, and the plugin refuses to connect with it. The plugin reads the
  map on connect: restart the instance after changing it.
- On connect the plugin lists the groups visible to the Sales key and warns
  about every mapped group that is not among them. It never blocks the
  connection.

```bash
omni instances update <id> \
  --zenvia-handoff-group-id <default-group> \
  --zenvia-handoff-routing '{"field":"queue_field","groups":{"queue-a":"group-1"}}'
```

**Conversation routing** (`zenviaHandoffSolution`, no Sales key). The only
primitive of the API v2 is the `conversation` field on an outbound message,
`{ "solution": ..., "properties": { ... } }`. The farewell carries it and
Zenvia hands the conversation to the solution when the contact replies.
`properties` carries `handoffReason`, `leadData` and the `handoffFields`.

With neither configured the plugin refuses the handoff instead of pausing the
agent on a conversation no human will see. `canCloseContact` is `false`:
neither API has an operation to close a conversation from here.

### Failure to HTTP status

The plugin tells a **definitive refusal** (repeating the same request cannot
succeed, so the caller should keep the conversation) from a **transient
failure** (worth retrying, or worth treating as unknown). A definitive refusal
returns `SendResult.rejected = true`, which `POST /messages/send/handoff`
answers as `422 CHANNEL_SEND_REJECTED` with `recoverable: false`. Every other
failed send, on every channel, keeps answering `502 CHANNEL_SEND_FAILED`.
Neither failure pauses the agent, writes an audit row or disarms follow-ups.

| Failure                                                                   | `rejected` | `retryable` | HTTP                         |
| ------------------------------------------------------------------------- | ---------- | ----------- | ---------------------------- |
| Handoff not configured (no transfer pair, no routing solution)            | `true`     | `false`     | 422 `CHANNEL_SEND_REJECTED`  |
| No Sales prospect for the contact's number                                | `true`     | `false`     | 422 `CHANNEL_SEND_REJECTED`  |
| Sales API refuses the lookup or the transfer with a 4xx other than 401, 403 and 429 | `true` | `false` | 422 `CHANNEL_SEND_REJECTED`  |
| Sales API answers the transfer with `success: false`                      | `true`     | `false`     | 422 `CHANNEL_SEND_REJECTED`  |
| `zenviaHandoffRouting` set, the queue maps to no group and there is no `zenviaHandoffGroupId` | `true` | `false` | 422 `CHANNEL_SEND_REJECTED`  |
| Sales key refused (401, 403): a credential problem, not a refusal of the lead | absent | `false`     | 502 `CHANNEL_SEND_FAILED`    |
| Rate limit (429)                                                          | absent     | `true`      | 502 `CHANNEL_SEND_FAILED`    |
| Sales or Zenvia 5xx, timeout, network failure                             | absent     | `true`      | 502 `CHANNEL_SEND_FAILED`    |
| Farewell fails in routing mode (no Sales transfer)                        | absent     | by cause    | 502 `CHANNEL_SEND_FAILED`    |

## v1 scope

**Outbound:**
- text, with Markdown converted to WhatsApp syntax;
- image, audio, video and document as a `file` content by public URL (a
  caption only on image and video, a file name only on documents);
- location;
- reply via `idRef`;
- template via `metadata.template = { id, fields }`. Zenvia templates take
  named fields, so positional `bodyParameters` are refused.

**Inbound:**
- text;
- file mapped to image/audio/video/document by MIME type;
- location;
- contacts (as text);
- quoted replies (`idRef`);
- statuses: `DELIVERED`, `READ`, and `REJECTED`/`NOT_DELIVERED`, which map
  to failed. When a status event carries no `message.to`, the chat comes from
  an in-memory map of `messageId -> recipient` recorded on every successful
  send (at most 5000 entries per instance, 24 hours each, oldest dropped first).
  A status for a message the map does not know (sent before a restart, or by
  another system) logs a `warn` with its `externalId` and is emitted with an
  empty chat id;
- dedupe by message id.

Files Zenvia itself marks as `REJECTED` are dropped. `MESSAGE` events with
`direction: OUT` are echoes of messages sent from the number and are
ignored.

**Out of scope:**
- interactive buttons and lists, contacts send, WhatsApp Flows, products;
- template CRUD (the Zenvia API has it; this plugin only sends);
- typing indicator (the API has none);
- reactions;
- `CONVERSATION_STATUS` (below).

## Not wired yet: conversation status

The ZCC guidance is that the chatbot stops sending once the transfer succeeds
and listens for the end of the conversation to resume later. Stopping is
covered by the handoff route. Resuming is not.

Zenvia reports the conversation lifecycle through `CONVERSATION_STATUS`
events (queued, distributed to an agent, claimed, transferred, snoozed,
closed), and the same signal would also tell the agent that a person took
over a conversation it did not hand off. Core has no channel-agnostic event
a plugin can publish for that: `agentPaused` is only set by the handoff and
close-contact routes, and only cleared by session reset or the chats routes.
Wiring it needs a small core contract first, for example a
`chat.human_takeover` / `chat.human_released` pair consumed next to
`chat.handoff_activated`, so that it works for every channel. Until then
these events are acknowledged and ignored.

## Open questions for the vendor

- The exact payload of the ZCC *Conversation Message* webhook: the event name
  (the ZCC guide says `MESSAGE_RECEIVED`, this plugin validates `MESSAGE`)
  and whether it carries the prospect id, which would save the lookup by phone.
- The phone format `prospect-by` expects (the plugin tries `+55...` and then
  digits only).
- Whether `conversation.solution` is still meaningful for a ZCC account, or
  the Sales transfer replaces it.
- Whether inbound `fileUrl`s require authentication, on which hosts they live
  and how long they stay valid.
- Whether a transfer to a `user` that does not belong to the target `group` is
  refused, and with which status.
- Whether the Sales `/groups` listing is paginated (the connect check only
  warns, so a missing page does not block anything).
- Rate limits for `POST /channels/whatsapp/messages` and for the Sales APIs.
