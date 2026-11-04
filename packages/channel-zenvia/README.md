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
    `downloadInboundMedia`, behind the SDK download guard. The token is sent
    only to Zenvia hosts, and only https URLs are fetched;
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
| `zenviaHandoffGroupId`  | no       | Sales group dedicated to the chatbot. Required with `zenviaSalesApiKey`.                    |
| `zenviaHandoffUserId`   | no       | A specific agent inside that group.                                                         |
| `zenviaHandoffSolution` | no       | `conversion` \| `zenvia_chat` \| `nlu`. Fallback routing when there is no Sales transfer.     |
| `webhookVerifyToken`    | no       | Shared secret. When set, every webhook POST must carry `x-webhook-token`.                   |

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

## Handoff

`POST /messages/send/handoff` has two modes, chosen by the instance config:

**Transfer through the Sales API** (`zenviaSalesApiKey` + `zenviaHandoffGroupId`).
This is the ZCC flow. In order:

1. `GET /api/v1/prospect-by?phoneNumber=` finds the prospect of the contact
   (with a leading `+`, then digits only). No prospect means no conversation
   to transfer, and the handoff fails before anything is sent to the contact.
2. `POST /api/v1/prospect/{id}/interactions` writes a `note` with the context
   the agent needs: `motivoHandoff`, `dadosLead` and every `handoffFields`
   key. A note that fails is logged and the transfer goes ahead.
3. `POST /api/v1/prospect/{id}/transfer` moves the prospect to the group, or
   to `zenviaHandoffUserId` inside it. A refusal, or `success: false`, fails
   the handoff and the farewell is not sent, so the agent keeps the chat.
4. The farewell text is sent through the API v2 as an ordinary message.
   If only this step fails, the handoff still counts as done, because the
   contact already belongs to a person.

The route's default side effects then run (`agentPaused`, follow-up disarm,
audit row). Requirements on the Zenvia side: the WhatsApp number must have
its destination set to *Atendimento Comercial* and be assigned to a group
created exclusively for the chatbot. On connect the plugin lists the groups
visible to the Sales key and refuses an unknown `zenviaHandoffGroupId`; a Sales
API that is merely unreachable does not block the connection.

**Conversation routing** (`zenviaHandoffSolution`, no Sales key). The only
primitive of the API v2 is the `conversation` field on an outbound message,
`{ "solution": ..., "properties": { ... } }`. The farewell carries it and
Zenvia hands the conversation to the solution when the contact replies.
`properties` carries `handoffReason`, `leadData` and the `handoffFields`.

With neither configured the plugin refuses the handoff instead of pausing the
agent on a conversation no human will see. `canCloseContact` is `false`:
neither API has an operation to close a conversation from here.

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
  to failed;
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
- Whether inbound `fileUrl`s require authentication and how long they stay
  valid.
- Rate limits for `POST /channels/whatsapp/messages` and for the Sales APIs.
