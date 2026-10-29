# Channel settings API

Update an existing channel instance with `PATCH /api/v2/instances/{id}` and
verify the stored values with `GET /api/v2/instances/{id}`. Both responses contain
`{ "data": { "id": "...", ... } }`. This does not create, delete, connect or
restart an instance.

## PATCH semantics

Send only the fields to change. Omitted fields retain their stored values;
`false`, `0` and empty arrays are explicit values, not omissions. Only the six
nullable fields marked below accept `null`. Arrays and nested objects replace
the whole stored value; they are not merged. A successful update emits the
existing `instance.updated` event with the instance ID, channel type and changed
**key names**, never setting values.

Malformed values, unknown fields and the read-only `agentProviderId` return
**400** before any update. Update the assigned agent, not its instance, to change
its provider. Existing authentication, instance access restrictions and tenant
scoping still apply.

## Settings exposed by this slice

These same 17 definitions are shared by runtime PATCH validation and the
published PATCH/GET OpenAPI schemas. No setting in this table has a PATCH default.

| Field | Accepted value | Nullable | Meaning |
| --- | --- | --- | --- |
| `agentChainToInstanceId` | UUID | Yes | Target instance; `null` clears the reference. |
| `chainMode` | `off`, `forward`, `bidirectional` | No | Agent chaining mode. |
| `triggerMode` | `round-trip`, `fire-and-forget` | No | Agent execution mode. |
| `triggerReactions` | Array of strings | Yes | Trigger emojis; `null` means all emojis when `reaction.received` is enabled in `triggerEvents`. |
| `triggerMentionPatterns` | Array of strings | Yes | Custom mention trigger patterns; `null` clears. |
| `disableUsernamePrefix` | Boolean | No | Stored username-prefix preference. |
| `agentAckMessage` | String | Yes | Pre-dispatch acknowledgement text; `null` disables. |
| `processAudio` | Boolean | No | Stored audio-processing flag; server transcription is controlled separately by `audioTranscription`. |
| `processImages` | Boolean | No | Stored image-processing flag. |
| `processVideo` | Boolean | No | Stored video-processing flag. |
| `processDocuments` | Boolean | No | Stored document-processing flag. |
| `processMediaOnBlocked` | Boolean | No | Stored media-processing preference for blocked messages. |
| `downloadMediaOnSync` | Boolean | No | Download media during history sync. |
| `inboundMaxAgeMinutes` | Integer, 0–2147483647 | No | Inbound age limit in minutes; `0` disables the age guard. |
| `replayEnabled` | Boolean | No | Automatically replay missed messages on reconnect. |
| `sessionReset` | Reset configuration below | Yes | `null` clears the per-instance reset configuration. |
| `followUpConfig` | Follow-up configuration below | Yes | `null` clears the instance override, allowing the agent scope to apply. |

This is a validation/persistence/readback change, not a new processing engine.
In particular, storing a media-processing flag does not add a missing runtime
consumer or override `audioTranscription`. Existing channel-specific behavior
and connect-time configuration lifecycles are unchanged.

### Chain target checks

A non-null target must exist and pass the same instance access guard as the
source. An unauthorized target returns **403** before lookup; a missing target
(or one invisible through the existing tenant-scoped service lookup) returns
**404**. Self-chaining returns **400**. These failures perform no update. Setting
`chainMode` does not create a reciprocal link or implicitly select a target.

### Session reset configuration

The only keys are `default`, `dm`, `group`, and `thread`, each optional. Each
value must be exactly one of:

- `{ "mode": "none" }`
- `{ "mode": "daily", "hour": 3 }` — optional integer `hour`, 0–23 UTC; runtime default is 3.
- `{ "mode": "idle", "minutes": 60 }` — optional positive finite number of minutes; runtime default is 60.

Unknown keys, modes and mode-inappropriate properties are rejected. For example:

```json
{
  "sessionReset": {
    "default": { "mode": "none" },
    "dm": { "mode": "idle", "minutes": 60 },
    "group": { "mode": "daily", "hour": 3 }
  }
}
```

### Follow-up configuration

Uses the core follow-up domain validator, including quiet-hours validation:

- Required: `schedule`, integer `maxFollowUps` (1–50), non-empty `promptTemplate`.
- Optional booleans `enabled`, `stopOutsideMessagingWindow`, and
  `showTypingIndicator` default to `true` **inside an explicitly supplied config**.
- `schedule`: either `{ "kind": "fixed", "intervalsMinutes": [15, 30] }`
  (non-empty positive finite intervals) or `{ "kind": "exponential",
  "initialMinutes": 5, "factor": 2, "maxMinutes": 60 }` (positive finite
  initial/max minutes, finite factor greater than 1).
- Either schedule may include `jitter`: exactly `{ "minutes": 2 }` (positive
  finite) or `{ "ratio": 0.1 }` (greater than 0 and at most 1).
- Optional `quietHours`: `start` and `end` in `HH:MM`, distinct times, valid
  `timezone` (for example `America/Sao_Paulo`), and optional nonnegative integer
  `spreadMinutes` shorter than the non-quiet period. Overnight windows work.

Unknown properties are rejected, including inside schedules and quiet hours.
Omitting `followUpConfig` does not install its nested defaults or change storage.

## Example update and readback

Use the same instance ID for both requests. The example is illustrative; it does
not perform a live request:

```sh
curl -X PATCH "$OMNI_URL/api/v2/instances/$INSTANCE_ID" \
  -H "x-api-key: $OMNI_API_KEY" -H 'content-type: application/json' \
  --data '{"replayEnabled":false,"inboundMaxAgeMinutes":20,"agentAckMessage":null}'

curl "$OMNI_URL/api/v2/instances/$INSTANCE_ID" -H "x-api-key: $OMNI_API_KEY"
```

Check `data.id`, `data.replayEnabled`, `data.inboundMaxAgeMinutes`, and
`data.agentAckMessage` in the GET response, rather than assuming a successful
HTTP status alone proves persistence.

## Explicitly deferred

The product already has a UI. UI wiring/repair, Meta credentials, token handling,
and business-channel repair are **not** implemented here. This slice also does
not change the database schema, generic instance persistence, channel consumers,
or other instance creation/deletion behavior.
