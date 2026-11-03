# Pair an agent host with your Omni

An agent host is a program that watches what happens on your Omni (Brain, a monitor, your own script). It pairs through the same device flow as the Automagik app, under its own client id, `omni-agent-host`. The key it gets **reads events and nothing else**.

The owner decides this, not the host. Pairing needs the owner's approval, and the key's scopes are fixed by the server.

## What the key can and cannot do

| Can | Cannot |
|---|---|
| List, get, search and trace events (`omni events list`, `get`, `trace`, `search`, `timeline`, `types`, `analytics`) | Send anything, or change any channel, chat, instance, automation, agent, provider, route or setting |
| Tail events by polling (`omni events stream`, `omni events wait`) | Pull, ack or stream a durable consumer (`omni events follow`), or create or delete one |
| List and inspect this Omni's durable consumers (name, filter, cursor, lag) | Mint, change or revoke keys, or approve another device |
| Check itself with `omni auth login --api-key <key>` | Trigger events or register event schemas |

Its single scope is `events:read`. Pass instance ids rather than names to `--instance`: resolving a name needs `instances:read`, which the key does not have.

The operator's `OMNI_DEVICE_KEY_SCOPES` is a ceiling: the key gets `events:read` only if that list holds `events:read` or `events:*` (the default does). When it holds neither, the exchange in step 4 answers `403 NO_DEVICE_SCOPES` and the device token stays unspent, so it can be used again after the operator changes the list.

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

   The answer's `data.apiKey` is the key. It is shown this once; store it as a secret and never log it. `data.scopes` is `["events:read"]`.

5. **Use it** as `x-api-key` on `/api/v2/events…`, or give it to the CLI with `omni auth login --api-key <key>`.

## Following a durable consumer

The key cannot pull or ack, because that scope (`events:write`) would also let it create and delete consumers and inject events. Until a narrower scope exists, a host that needs at-least-once delivery polls `omni events stream` or `wait` from a timestamp it stores itself, or the owner runs `omni events follow` with a full key.

## Limits

- **Multitenancy:** pairing is off on a multitenant Omni, so an agent host cannot pair there.
- **Revoking:** `omni keys revoke <id>`. The key id is in the approval's `access.device_authorized` event and in `omni keys list` as `device: <deviceName>`.
- **Expiry:** keys last as long as `OMNI_DEVICE_KEY_TTL_DAYS` says, or until revoked.
