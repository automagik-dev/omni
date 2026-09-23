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

| Key                     | Required | Notes                                                                      |
| ----------------------- | -------- | -------------------------------------------------------------------------- |
| `zenviaApiToken`        | yes      | `X-API-TOKEN` header. Sealed at rest.                                      |
| `zenviaSenderId`        | yes      | The sender registered at Zenvia (the WhatsApp number).                     |
| `zenviaHandoffSolution` | no       | `conversion` \| `zenvia_chat` \| `nlu`. If unset, handoffs are refused.    |
| `webhookVerifyToken`    | no       | Shared secret. When set, every webhook POST must carry `x-webhook-token`.  |

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

The Zenvia API has **no endpoint** to transfer, assign or queue a
conversation. Its only routing primitive is the `conversation` field on an
outbound message: `{ "solution": ..., "properties": { ... } }`. When the
contact replies to that message, Zenvia hands the conversation to the
solution.

`POST /messages/send/handoff` therefore works like this:

1. The farewell text is sent with `conversation.solution` taken from
   `zenviaHandoffSolution`.
2. `properties` carries `handoffReason` (from `motivoHandoff`), `leadData`
   (from `dadosLead`) and every key of `handoffFields`. Explicit
   `handoffFields` keys win.
3. The route's default side effects run: `agentPaused`, follow-up disarm and
   the audit row. The contact's next message belongs to the solution, and
   the agent must not answer it.

With no solution configured there is nowhere to route to. The plugin then
refuses the handoff instead of pausing the agent on a conversation no human
will see.

`canCloseContact` is `false`, because the API has no operation to close a
conversation.

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
- template CRUD;
- typing indicator (the API has none);
- reactions;
- `CONVERSATION_STATUS` (below).

## Not wired yet: conversation status

Zenvia reports the conversation lifecycle through `CONVERSATION_STATUS`
events: queued, distributed to an agent, claimed, transferred, snoozed and
closed. That is exactly the signal needed to:
- pause the agent when a person takes over a conversation the agent did not
  hand off;
- resume it when the person closes the conversation.

Today, though, core has no channel-agnostic event a plugin can publish to
say "a human took over / released this chat". `agentPaused` is only set by
the handoff and close-contact routes, and only cleared by session reset or
the chats routes. Wiring this needs a small core contract first, for
example a `chat.human_takeover` / `chat.human_released` pair consumed next
to `chat.handoff_activated`, so that it works for every channel rather than
as a Zenvia special case. Until then these events are acknowledged and
ignored.

## Open questions for the vendor

- Whether `conversation.properties` can select a queue or group inside the
  solution, or is only informational.
- Whether inbound `fileUrl`s require authentication and how long they stay
  valid.
- How the `conversation` routing interacts with a conversation that is
  already open in the solution.
- Rate limits for `POST /channels/whatsapp/messages`.
