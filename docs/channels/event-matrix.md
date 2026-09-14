# Channel Event Matrix

Which core events each channel plugin emits, and how their journal
idempotency keys are built (#1149). Keys are claimed in
`BaseChannelPlugin.publishClaimed` before publish; a redelivery that claims an
already-journaled key is skipped.

| Event | WhatsApp (Baileys) | Slack | Telegram | Discord |
|---|:-:|:-:|:-:|:-:|
| `message.received` | ✅ | ✅ | ✅ | ✅ |
| `message.sent` | ✅ | ✅ | ✅ | ✅ |
| `reaction.received` / `reaction.removed` | ✅ | ✅ | ✅ (Bot API 7.3+ `message_reaction`) | ✅ |
| Edit (`message.received`, `content.type: edit`) | ✅ | — | ⚠️ re-emitted as the original content type | ✅ |
| Delete (`message.received`, `content.type: delete`) | ✅ | — | — (Bot API has no delete update) | ✅ |

## Idempotency keys

| Event | Key |
|---|---|
| `message.received` | `{channel}:{instance}:{keyId}:{content.type}` |
| `message.sent` | `{channel}:{instance}:{keyId}:message.sent` |
| `reaction.*` | `{channel}:{instance}:{keyId(reactionId or messageId:from)}:{event}:{emoji}` |

`keyId` is the platform message id, except on Telegram where `message_id` is
only unique per chat, so it is `{chatId}:{message_id}`.

Known gaps:

- Edits and deletes on WhatsApp and Discord embed a timestamp in `externalId`,
  so their keys are not stable across redelivery.
- Telegram edits reuse the original message's key, so an edit of an
  already-journaled message is skipped as a duplicate.
- A `message.sent` with no platform id (e.g. Telegram reaction sends) is
  published without a key.
