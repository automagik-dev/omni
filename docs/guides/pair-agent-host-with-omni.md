# Pair an agent host with your Omni

An agent host is a program that watches what happens on your Omni (Brain, a monitor, your own script). It pairs through the same device flow as the Automagik app, under its own client id, `omni-agent-host`. The key it gets **reads events and runs durable consumers of its own, and nothing else**.

The owner decides this, not the host. Pairing needs the owner's approval, and the key's scopes are fixed by the server.

## What the key can and cannot do

| Can | Cannot |
|---|---|
| List, get, search and trace events (`omni events list`, `get`, `trace`, `search`, `timeline`, `types`, `analytics`) | Send anything, or change any channel, chat, instance, automation, agent, provider, route or setting |
| Tail events by polling (`omni events stream`, `omni events wait`) | See, pull, ack, stream or delete a consumer it did not create: those answer 404, as a missing name does |
| Create durable consumers, then pull, ack, stream, inspect, list and delete them (`omni events consumers`, `omni events follow --consumer <name>`) | Own more than 10 consumers at a time: the 11th create answers `409 CONSUMER_LIMIT_REACHED` |
| Check itself with `omni auth login --api-key <key>` | Trigger events or register event schemas |
| | Mint, change or revoke keys, or approve another device |

Its scopes are `events:read` and `events:consume`. `events:consume` opens only the consumer routes, and only for the consumers this key created. `events:write`, which an owner's full key holds, also reaches every other consumer of the Omni, triggers events and registers schemas; the host does not get it. Pass instance ids rather than names to `--instance`: resolving a name needs `instances:read`, which the key does not have.

The operator's `OMNI_DEVICE_KEY_SCOPES` is a ceiling that narrows and never widens. The host gets each of `events:read` and `events:consume` only where that list names it or holds `events:*` (the default does). A list with `events:read` and no `events:consume` mints a read-only key, not a refusal. A list with neither, `events:write` alone included, makes the exchange in step 4 answer `403 NO_DEVICE_SCOPES`, and the device token stays unspent, so it can be used again after the operator changes the list.

## Pairing

The host speaks the device flow (RFC 8628) itself. `omni auth login` without a key pairs the CLI as `omni-cli`, which gets the operator's full device-key scopes, so do not use it for an agent host.

1. **Ask for a code.**

   ```http
   POST /api/auth/device/code
   Content-Type: application/json

   {"client_id": "omni-agent-host"}
   ```

   The answer has `device_code`, `user_code` (like `ABCD-EFGH`), `verification_uri_complete`, `interval` and `expires_in`. Show the user code and the link. The code lasts ten minutes.

2. **The owner approves it.** On the server: `omni approve ABCD-EFGH`. Or the owner opens the link, or sends `Omni ABCD-EFGH` to themselves on WhatsApp if that is linked (see [Pair DSH with your Omni](pair-dsh-with-omni.md)). The approval names the client as "an agent host (read events only)".

3. **Poll for the device token**, no faster than `interval` seconds:

   ```http
   POST /api/auth/device/token
   Content-Type: application/json

   {"grant_type": "urn:ietf:params:oauth:grant-type:device_code",
    "device_code": "<device_code>", "client_id": "omni-agent-host"}
   ```

   `authorization_pending` means keep polling, and `slow_down` means poll less often. Stop on `access_denied` or `expired_token`. On approval the answer has an `access_token`.

4. **Trade the token for the key**, once:

   ```http
   POST /api/v2/login/device-key
   Authorization: Bearer <access_token>
   Content-Type: application/json

   {"deviceName": "brain on my-box"}
   ```

   The answer's `data.apiKey` is the key. It is shown this once; store it as a secret and never log it. `data.scopes` is `["events:read", "events:consume"]`.

5. **Use it** as `x-api-key` on `/api/v2/events…`, or give it to the CLI with `omni auth login --api-key <key>`.

## Following a durable consumer

For at-least-once delivery the host runs its own consumer. Create it once, then follow it. With the CLI, `omni events consumers create <name> --type 'custom.*'` and then `omni events follow --consumer <name>`. Over the API, `POST /api/v2/events/consumers` with `{"name": ..., "eventType": ...}`, then `POST .../{name}/pull` and `POST .../{name}/ack` with the page's `cursor` (or `GET .../{name}/stream` for SSE push). Delete it with `DELETE .../{name}` when the host no longer needs it.

The consumer belongs to the key that created it. Another key, and the host's next key after re-pairing, cannot see it, and an owner key with `events:write` can still list and delete it. A host that re-pairs creates its consumer again under the new key.

## Limits

- **Multitenancy:** pairing is off on a multitenant Omni, so an agent host cannot pair there.
- **Revoking:** `omni keys revoke <id>`. The id is `data.keyId` in the step 4 answer; `omni keys list` shows its first 8 characters next to `device: <deviceName>`, and `revoke` accepts that prefix.
- **Expiry:** keys last as long as `OMNI_DEVICE_KEY_TTL_DAYS` says, or until revoked.
