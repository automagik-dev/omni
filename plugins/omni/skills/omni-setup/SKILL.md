---
name: omni-setup
description: "Configure an existing Omni or install a local runtime, connect a channel, wire an agent, and verify."
allowed-tools: Bash(omni *), Bash(genie *), Bash(pm2 *)
---

# Omni Setup

Choose the requested target first. An auth failure on a remote Omni is not a reason to install or restart a local server.

## 1. Existing server or local install

For an existing server:

```bash
omni server list --json
omni server add <name> <url>                  # registers the URL; obtains no credential
omni auth login --server <name> --api-key-stdin < /secure/path/omni-api-key
omni server use <name>                       # or use --server <name> per command
omni status --json
omni auth status --json
```

Read the key from a protected file as above or pipe it from your secret manager. If `OMNI_CLI_API_KEY` is already supplied securely in the environment, omit the key flags. Explicit `--api-key-stdin` or legacy `--api-key` overrides that env var; do not combine the flags. Do not ask for a key in chat or paste its value into a command.

`OMNI_API_KEY` is the API server's primary key and is ignored by login. Only
`OMNI_CLI_API_KEY` is used as the CLI environment fallback. Stdin is limited to
8 KB including the optional trailing LF/CRLF. A successful login reports
`keySource` as `flag`, `stdin`, or `env`, without printing the key.

An API key is still required. There is no CLI device-code sign-in: adding a keyless server entry only saves its address. `auth login` validates the supplied key and saves it in the targeted server entry. Currently owner-approved device keys cannot pass that validation because they lack `auth:validate`; ask the operator for an appropriate existing CLI credential rather than widening a key or disabling scope checks.

Only when a local install is requested:

```bash
omni install --help
omni install                                 # non-interactive, reinstall-safe bootstrap
omni status --json
```

`--non-interactive` is a deprecated no-op. Choose `--port`, `--database-url` (external Postgres), or `--systemd` when appropriate. `--sandbox` installs an isolated runtime; inspect `omni sandbox --help` and install help for `--home`, `--at-login`, `--no-start` and other sandbox options. `omni desktop --help` covers the desktop app. Installing or starting services needs authorization.

### Operator device approval is separate

An operator already holding a key with `auth:admin` can use `omni claim`, `omni approve <code>`, or bare `omni connect` (optionally `--url https://omni.example.com`). Claim makes an unclaimed Omni theirs; approve accepts a waiting device code; connect prints a one-time link/QR for a supported app. These are not ways for a keyless agent or CLI to grant itself access. Human login must be enabled and is unavailable with multitenancy. The full app flow is in `docs/guides/pair-dsh-with-omni.md` in the Omni repository.

### Agent hosts pair read-only

An agent host that only watches events (Brain, a monitor) pairs as device client `omni-agent-host`: it requests a code (`POST /api/auth/device/code` with that `client_id`), the owner runs `omni approve <code>`, it polls `POST /api/auth/device/token`, then trades the token once at `POST /api/v2/login/device-key`. The key holds only `events:read`, and the operator's `OMNI_DEVICE_KEY_SCOPES` can narrow it but never widen it. It can list, get, search, trace, `stream` and `wait` on events, and list or inspect consumers. It cannot send or change anything, mint keys, or pull, ack, create or delete a durable consumer (`omni events follow`). Do not pair an agent host with keyless `omni auth login`: that pairs as `omni-cli`, which gets the full device-key scopes. Steps are in `docs/guides/pair-agent-host-with-omni.md` in the Omni repository.

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

For a compatible external Genie runtime, two-argument connect configures Omni:

```bash
omni connect <instance-id> <agent-name> --reply-filter filtered
```

It verifies the installed Genie's directory JSON interface before discovering the agent and changing Omni records. Incompatible Genie versions are refused; use `genie --help` and that version's documentation, or choose another supported provider through `setup agent`. Do not assume `genie dir add`, `genie serve start/status`, `genie ls --source omni` or `genie events` exist.

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
