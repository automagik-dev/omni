# Pair DSH with your Omni

The Automagik app, and the Omni plugins in your own DeepSeek Harness (DSH), connect to an Omni by pairing. You don't need API keys, environment variables or HTTPS. You don't even need a WhatsApp number.

Claiming without WhatsApp, `omni approve` and `omni connect` need an Omni newer than 2.261023.16. On an older one, update it first (see [Updating](#updating)), or paste an API key in the app instead.

## The short way

1. **Claim your Omni**, once. On the server, run:

   ```sh
   omni claim
   ```

   Whoever runs the server owns it. The CLI's own key (the primary key) proves that.

2. **In the app** (or the plugin's Connect step), type your Omni's address, such as `http://my-box.tail1234.ts.net:8882`, and click **Get a code**. The app shows a code like `ABCD-EFGH`.

3. **On the server**, let it in:

   ```sh
   omni approve ABCD-EFGH
   ```

   The app finishes on its own. `omni approve` on an Omni nobody owns claims it first and says so, so you can skip step 1.

### The other way round

On the server, run:

```sh
omni connect
```

It prints a one-time link and its QR. Open the link on the computer you're connecting, or paste it into the app under **Connect your Omni**. It works once, for ten minutes. If devices reach your Omni on a different address than the CLI does, pass that address: `omni connect --url https://omni.example.com`.

## Approving from your phone (optional)

To approve devices from your phone without a terminal, link a WhatsApp to the owner:

1. Open the claim link from the server log (`This Omni has no owner yet. Claim it: …`) or, after `omni claim`, the same link again.
2. Choose **Connect my WhatsApp**, scan the QR from WhatsApp → Linked devices, and type the code Omni sends to your chat with yourself.

From then on you can:

- send a device's code (`Omni ABCD-EFGH`) to yourself on WhatsApp to approve it;
- text `connect` to yourself to get a one-time link. That needs a fixed address; see below.

Linking WhatsApp means Omni receives that account's messages. Use a number you want Omni to see.

## Settings you may want

All optional. A CLI install keeps them in `~/.omni/config.json`, so they survive `omni stop && omni start` and a reinstall:

| What | CLI | Environment |
|---|---|---|
| The address people reach your Omni on | `omni config set server.publicUrl https://omni.example.com` | `OMNI_PUBLIC_URL` |
| Turn pairing off | `omni config set server.login off` | `OMNI_LOGIN_ENABLED=false` |
| What a paired device may do | | `OMNI_DEVICE_KEY_SCOPES` |
| How long a device key lasts | | `OMNI_DEVICE_KEY_TTL_DAYS` |

Apply a change with `omni stop && omni start`.

- **Without a public address**, links follow the address each device used, which is fine on a tailnet or a LAN. Two things need a fixed one:
  - **Passkeys** (Face ID, Touch ID, fingerprints) on the approval page: WebAuthn binds a passkey to one host. HTTPS matters for passkeys only.
  - **The WhatsApp `connect` reply**: a link sent on its own is never built from a request's address.
- **The login secret** signs sessions and the claim link. Omni generates it at first boot and keeps it in its database, so every replica shares it. Set `OMNI_AUTH_SECRET` (32 characters or more) only to choose it yourself.
- **Device keys** operate all of Omni, so the Omni Bot of a paired app has full control of it: channels, chats, messages, events, persons, automations, agents, providers, routes and the rest of the API, plus `system:read` and `system:update` to see the version and ask the owner to update. The list is `DEFAULT_DEVICE_KEY_SCOPES` in `packages/api/src/login/config.ts`. `logs:*` and `metrics:*` come only when `OMNI_DEVICE_KEY_SCOPES` lists them. A key keeps the scopes it was minted with, so a device paired before this change has the old ones until it pairs again. Device keys can never hold `keys`, `settings`, `auth`, `trust`, `audit` or `platform` scopes, even if `OMNI_DEVICE_KEY_SCOPES` lists them. Revoke one with `omni keys revoke <id>`.

## Source and Docker installs

Pairing lives in the API, so it works the same without the CLI's installer:

- **A git checkout run by PM2 or systemd:** nothing to set. Set `OMNI_PUBLIC_URL` in its `.env` only if you want passkeys or the WhatsApp `connect` reply. To use `omni claim`, `omni approve` and `omni connect` from that machine, point the CLI at it with the primary key: `omni auth login --api-key <primary key>`.
- **Docker / Helm:** nothing to set for pairing. Several replicas share the generated secret through the database. Pass `OMNI_PUBLIC_URL` as an env var when people reach the Omni on a fixed address.

## Updating

- **CLI installs:** `omni update`.
- **Source checkouts:** pull the new tag, run `bun install`, and restart the API. It migrates the database on boot.
- **Docker:** pull the new image tag.

## When something's off

| What you see | Why, and what to do |
|---|---|
| "too old to pair" | The Omni predates pairing. Update it, or paste an API key in the app. |
| "Pairing is off on this Omni" | `OMNI_LOGIN_ENABLED=false`, or multitenancy is on. |
| "has no owner yet" | Run `omni claim` on the server. |
| `omni approve` says "No device is waiting" | Codes last ten minutes. Click **Get a code** again. |
| `omni claim` says the key can't do that | The CLI isn't using the primary key. `omni auth login --api-key <primary key>`. |
