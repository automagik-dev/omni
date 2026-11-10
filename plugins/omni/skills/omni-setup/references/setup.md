# Setup details

Read `omni --help` and the relevant command help before using these examples. They supplement the setup flow; they are not a command inventory. Genie compatibility was checked against 6.261109.1 on 2026-11-10; it provides neither a directory interface nor an Omni bridge. No NATS topic table is prescribed.

Choose the requested target first. An auth failure on a remote Omni is not a reason to install or restart a local server.

## 1. Existing server or local install

For an existing server:

```bash
omni server list --json
omni server add <name> <url>                  # no key: starts owner-approved device sign-in
omni server use <name>                       # or use --server <name> per command
omni status --json
omni auth status --json
```

In an interactive terminal, keyless `server add` shows an approval code and link, waits for the owner to approve, then saves the device key in that server entry. The CLI caps the approval wait at 15 minutes. Keyless device sign-in requires an interactive terminal; without a TTY it exits 2 and saves nothing. To sign in to an existing entry, use `omni auth login --server <name>`; bare `omni auth login` targets the current server. `auth login` starts device sign-in only when no key flag, stdin key, or `OMNI_CLI_API_KEY` is supplied. If the server does not offer device sign-in (login disabled, or multitenancy enabled), interactive `server add` can save a new entry without a key; sign in with an existing credential instead.

For scripts or an existing credential, register the entry without verification, then sign in with protected input:

```bash
omni server add <name> <url> --skip-verify
omni auth login --server <name> --api-key-stdin < /secure/path/omni-api-key
```

Read the key from a protected file as above or pipe it from your secret manager. If `OMNI_CLI_API_KEY` is already supplied securely in the environment, omit the key flags. Explicit `--api-key-stdin` or legacy `--api-key` overrides that env var; do not combine the flags. Do not ask for a key in chat or paste its value into a command.

`OMNI_API_KEY` is the API server's primary key and is ignored by login. Only
`OMNI_CLI_API_KEY` is used as the CLI environment fallback. Stdin is limited to
8 KB including the optional trailing LF/CRLF. A successful login reports
`keySource` as `device`, `flag`, `stdin`, or `env`, without printing the key.

Device sign-in obtains a scoped API key through owner approval. Owner-approved device keys work with CLI validation without adding `auth:validate` or widening their scopes. With a supplied key, `auth login` validates it and saves it in the targeted server entry.

Only when a local install is requested:

```bash
omni install --help
omni install                                 # non-interactive, reinstall-safe bootstrap
omni status --json
```

`--non-interactive` is a deprecated no-op. Choose `--port`, `--database-url` (external Postgres), or `--systemd` when appropriate. `--sandbox` installs an isolated runtime; inspect `omni sandbox --help` and install help for `--home`, `--at-login`, `--no-start` and other sandbox options. `omni desktop --help` covers the desktop app. Installing or starting services needs authorization.

### Operator approval and app pairing

An operator already holding a key with `auth:admin` can use `omni claim`, `omni approve <code>`, or bare `omni connect` (optionally `--url https://omni.example.com`). Claim makes an unclaimed Omni theirs; approve accepts a waiting device code; connect prints a one-time link/QR for a supported app. These are not ways for a keyless agent or CLI to grant itself access. Human login must be enabled and is unavailable with multitenancy. The full app flow is in `docs/guides/pair-dsh-with-omni.md` in the Omni repository.

### Agent hosts pair with bounded event access

An agent host (Brain, a monitor) pairs as device client `omni-agent-host`: it requests a code (`POST /api/auth/device/code` with that `client_id`), the owner runs `omni approve <code>`, it polls `POST /api/auth/device/token`, then trades the token once at `POST /api/v2/login/device-key`. Its default scopes are `events:read` and `events:consume`; the operator's `OMNI_DEVICE_KEY_SCOPES` can narrow them but never widen them. It reads events and can create, pull, acknowledge, stream or delete only the durable consumers its key created (at most 10). Without `events:consume`, it is read-only. It cannot send messages, trigger events, register schemas, mint keys or access another key's consumers. Use instance IDs: resolving instance names needs an additional scope. Do not pair an agent host with keyless `omni auth login`: that pairs as `omni-cli`, which gets the full device-key scopes. Steps are in `docs/guides/pair-agent-host-with-omni.md` in the Omni repository.

## 2. Connect a channel

```bash
omni instances list --json                    # reuse the intended connected instance
omni channels --help
omni channels add whatsapp-baileys            # interactive channel setup
```

For explicit provisioning, use `omni instances create --name "Support" --channel <type>`, then the channel's connection flow. `omni start` starts the local API/NATS through PM2; it does not display a WhatsApp QR or create a channel instance.

For an existing WhatsApp instance:

```bash
omni instances pair <id> --phone +5511999999999
omni instances qr <id>                        # QR fallback; --no-watch for one shot
omni instances list --json
```

Scan a pending QR in WhatsApp → Linked Devices. For a pending WhatsApp passkey ceremony, inspect `omni instances passkey --help`, `passkey-submit --help` and `passkey-confirm --help` before submitting the one-time response. Other channel credentials and setup are in `omni channels add --help`.

## 3. Wire the agent

```bash
omni setup agent --help
```

This wires a provider, agent and instance binding and performs a health check. Choose a supported schema and its required flags: `agno`, `webhook`, `ag-ui`, `claude-code`, `a2a`, or `nats-genie`. Inspect existing providers/agents before creating duplicates. A health check alone does not prove replies work end to end.

Only after verifying a compatible external Genie directory and bridge contract, two-argument connect configures Omni:

```bash
omni connect <instance-id> <agent-name> --reply-filter filtered
```

It verifies the installed Genie's directory JSON interface before discovering the agent and changing Omni records. Incompatible Genie versions are refused; use `genie --help` and that version's documentation, or choose another supported provider through `setup agent`. The installed Genie 6.261109.1 has no directory or Omni bridge interface; this two-argument wiring path is incompatible with it. Do not attempt it on that version.

| Flag | Behavior |
|------|----------|
| `--mode turn-based` | Default; the external agent closes every turn with `omni done` |
| `--mode fire-and-forget` | Configure fire-and-forget dispatch |
| `--reply-filter filtered` | Limit dispatch using reply conditions; inspect the resulting instance filter |
| `--reply-filter all` | Default: every inbound message can trigger, including groups |
| `--nats-url <url>` | Matching local sandbox metadata is used when available; localhost:4222 is only the standard local API fallback. Required for remote/nondefault targets without verified local metadata |

`connect` does not start or verify the external bridge. Start that runtime only through its supported version's instructions and verify it separately. Never expose NATS without auth/TLS or a private network.

## 4. Verify the requested path

```bash
omni instances get <instance-id> --json        # inspect agentId and reply filter
omni providers list --json
omni agents list --json
omni events stream --instance <instance-id>
```

With authorization, send a test message to the intended channel and observe the agent reply there. Report configuration, runtime health and delivered replies separately. Turn-based dispatch supplies `OMNI_INSTANCE`, `OMNI_CHAT`, `OMNI_MESSAGE`, `OMNI_TURN_ID`; replies use verbs and close with `omni done` (agent skill).

## Troubleshooting

| Symptom | Check / fix |
|---------|-------------|
| No credential or auth denied | Check `omni server current --json` and the targeted key's scopes with the operator. `auth status` failure does not prove the API is stopped |
| Server unreachable | `omni status --json`; verify the selected URL. For an authorized local managed runtime, inspect PM2 or `omni sandbox status` as appropriate |
| Local runtime config | `omni config list --json` (keys are masked); local settings are `server.*` in the CLI config, distinct from the remote `omni server` registry |
| Genie directory unsupported | Consult `genie --help` and its installed version's integration docs; no unverified bridge recipe |
| Messages arrive but no reply | Inspect instance `agentId`, reply filter, provider health and `omni events trace <event-id>`; verify the external runtime independently |
| QR expired | `omni instances qr <id>` or `omni instances pair <id> --phone +55...` |
