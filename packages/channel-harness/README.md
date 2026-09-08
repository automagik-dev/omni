# @omni/channel-harness

E2E agent-testing channel (issue #953): a real channel plugin whose transport
**is the test harness**. `channel-internal`'s sibling — no external platform,
but where internal *routes* (and keeps only `content.text`), the harness
*captures* the full `OutgoingMessage` verbatim and *exposes* it per `chatId`.

Everything between the drive and the capture is the production path: the
dispatcher, the agent provider, `message.received` / `message.sent`. A test
exercises the same code path production does.

## Surface (mounted by @omni/api, auth-required)

```
POST   /api/v2/channels/harness/{instanceId}/say
       { "chatId": "case-42", "text": "quero marcar cardiologista" }
       → emits message.received exactly as a real channel webhook would

GET    /api/v2/channels/harness/{instanceId}/transcript?chatId=case-42
       → ordered, verbatim per-chat capture: every OutgoingMessage handed to
         sendMessage() (buttons/lists/metadata included, refused sends too)
         plus the injected inbounds; echoes the instance's capability profile

POST   /api/v2/channels/harness/{instanceId}/tap
       { "chatId": "case-42", "option": 2 }
       → converts a button/row of the component the agent ACTUALLY sent into
         the inbound a real tap produces (text = the option's title — the
         whatsapp-business / hermes parser precedent)

DELETE /api/v2/channels/harness/{instanceId}/transcript?chatId=case-42
       → reset one chat (omit chatId to reset the whole instance)
```

`chatId` is free-form: N scenarios run as N parallel, isolated conversations
on one instance.

## Capability profile

Per-instance, stored on the instance's `profileMetadata.harnessProfile`
(generic jsonb — no schema migration) and enforced by `sendMessage()`:

```jsonc
{
  "canSendText": true,       // default true
  "canSendMedia": true,      // default true
  "canSendButtons": true,    // default true
  "canSendList": true,       // default true
  "maxButtons": 3,           // default 3  (WhatsApp reply-button ceiling)
  "maxListRows": 10,         // default 10 (WhatsApp list ceiling)
  "maxMessageLength": 0      // default 0 = unlimited
}
```

Set it via `PATCH /api/v2/instances/{id}` with
`{ "profileMetadata": { "harnessProfile": { ... } } }`, then (re)connect the
instance — connect parses it (Zod, strict: typos fail loudly).

Rendering rule: a component renders as a **list** when
`content.list.forceList` is set or the option count exceeds `maxButtons`,
otherwise as reply **buttons** (mirrors `channel-sdk/interactive-plan`'s
count-decides split). A send that breaks the profile is refused
(`success: false`, `message.failed`) and still captured verbatim with its
`violations` — so a CI assertion sees exactly what would have degraded or
vanished on the real platform.

Plugin-level `capabilities` are deliberately permissive so agent-side
allowlists *attempt* components on the harness; the per-instance profile is
what decides pass/fail. There is intentionally no platform-wide
`getCapabilities(instanceId)` seam.

## Transcript shape

```jsonc
{
  "chatId": "case-42",
  "profile": { /* the enforced capability profile */ },
  "droppedEntries": 0,
  "entries": [
    { "seq": 1, "direction": "inbound",  "kind": "say", "from": "user:case-42",
      "content": { "type": "text", "text": "quero marcar cardiologista" } },
    { "seq": 2, "direction": "outbound", "externalId": "harness-…",
      "message": { /* full OutgoingMessage, verbatim */ },
      "violations": [], "result": { "success": true } },
    { "seq": 3, "direction": "inbound",  "kind": "tap",
      "content": { "type": "text", "text": "Aneli" },
      "tap": { "sourceSeq": 2, "optionIndex": 2, "optionId": "prof-2", "optionText": "Aneli" } }
  ]
}
```

Assertions read structure, not logs:

```ts
const outbound = transcript.entries.find((e) => e.direction === 'outbound');
expect(outbound.message.content.buttons.map((b) => b.text)).toEqual(['Rogerio', 'Aneli']);
expect(outbound.message.metadata.handoffQueue).toBe('SKILL_WPP_TECNICA_GENESYS');
```

## Storage & bounds

In-memory only (documented, deliberate): transcripts live in the plugin
process and vanish on restart. Per chat the newest 1000 entries are kept
(evictions are counted in `droppedEntries`); an instance holds at most 500
chats — beyond that, new chats are refused rather than silently evicting a
running scenario. Transcripts survive `disconnect()`; clear them with the
DELETE route.

## What this is not

Not a platform emulator — fidelity to a specific BSP belongs in that
channel's own tests, and platform-side failure modes (encoding flattening,
200-but-refused components, flow-variable timing) are only reachable on the
real line. The harness covers everything that is *not* the platform.
