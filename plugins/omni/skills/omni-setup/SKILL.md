---
name: omni-setup
description: "Get Omni running from scratch — install, connect WhatsApp, plug your agent, verify. Zero to messaging in 4 steps."
allowed-tools: Bash(omni *), Bash(genie *), Bash(pm2 *)
---

# Omni Setup — Zero to Messaging in 4 Steps

Canonical install → connect → plug → verify flow. Each step starts with a check — if it already passes, skip ahead. Report each step as done only after its verify command confirms it.

## Step 1: Install

```bash
omni auth status                  # valid connection? skip to Step 2
omni install                      # interactive wizard: system checks, NATS, PM2, ports, API key → ~/.omni/config.json
omni install --non-interactive    # scripted/CI installs
omni status                       # verify server health before moving on
```

## Step 2: Connect channel

```bash
omni instances list               # an instance with status "connected"? note its ID, skip to Step 3
omni start                        # starts services and shows a WhatsApp QR code
```

Scan with WhatsApp (Settings > Linked Devices > Link a Device). The QR expires in ~60s — regenerate with `omni instances qr <id>`, or skip QR entirely with a pairing code: `omni instances pair <id> --phone +5511999999999`. Confirm with `omni instances list` (status `connected`).

Other channels (Telegram, Discord, ...): `omni instances create --channel <type>` — see `omni channels --help`.

## Step 3: Plug agent

```bash
omni connect <instance-id> <agent-name>
```

One command does it all: discovers the agent in the Genie directory, creates a `nats-genie` provider, creates the Omni agent record, and updates the instance (agentId FK, provider, reply filter, trigger mode). It replaces the deprecated `omni providers setup genie`.

| Flag | Default | Behavior |
|------|---------|----------|
| `--mode` | `turn-based` | `turn-based` (agent closes each turn with `omni done`) or `fire-and-forget` |
| `--reply-filter` | `all` | `all` = reply to every inbound message; `filtered` = conditions (DM, mention, reply on by default) |
| `--nats-url` | `localhost:4222` | NATS server used by the provider |

> **`--reply-filter all` means reply to EVERYTHING** — on WhatsApp that includes every group and broadcast the account is in. If the instance will join groups, pass `--reply-filter filtered` at connect time, or tighten later:
> `omni instances update <id> --reply-filter-mode filtered --reply-on-dm`
> A null/missing filter also lets every message through (behavior change in automagik-dev/omni#371); the API logs a one-time warning per instance.

Agent not registered yet? `genie dir add <agent-name> --dir /path/to/agent`, then re-run `omni connect`.

## Step 4: Start bridge

The NATS ↔ agent bridge (`OmniBridge`) runs inside `genie serve` — there is no `genie omni start`.

```bash
genie serve start
genie serve status                                             # verify the bridge is live
pm2 start "genie serve start" --name genie-serve && pm2 save   # long-running deployments
```

Message flow: inbound NATS event → bridge routes to the agent (spawns a session if needed, sets `OMNI_INSTANCE`, `OMNI_CHAT`, `OMNI_MESSAGE`, `OMNI_AGENT`) → agent replies with verb commands → `omni done` closes the turn.

### NATS topic contract

Debug any hop with `nats sub '<pattern>'`:

| Direction | Subject | Purpose |
|-----------|---------|---------|
| Omni → Genie | `omni.message.<instance-id>.<chat-id>` | Inbound message payload |
| Genie → Omni | `omni.reply.<instance-id>.<chat-id>` | Agent reply back to the channel |
| Omni → Genie | `omni.session.reset.<instance-id>.<chat-id>` | `{ action: 'kill' }` — drop the in-memory session |
| Omni → Genie | `omni.turn.{open,done,nudge,stalled,timeout}.<instance-id>.<chat-id>` | Turn lifecycle signals |

Omni subscribes with the recursive wildcard `omni.reply.<instance-id>.>` because WhatsApp chat IDs contain dots (`5511...@s.whatsapp.net`) that the single-token `*` wildcard does not match.

## Verify end-to-end

```bash
omni where                          # active instance + chat context
omni instances get <instance-id>    # agentId must NOT be null
genie ls --source omni              # agent appears after its first message
omni use <instance-id>
omni open <chat-jid>
omni say "test"
```

A reply appearing in the chat = the full pipeline works.

## Troubleshooting

| Symptom | Check / fix |
|---------|-------------|
| Bridge won't start, connection refused | `pm2 list` → `pm2 restart omni-nats`; `pm2 logs omni-nats`. Never started? `~/.omni/nats-server -js -sd ~/.omni/data/nats` |
| API 500s / degraded mode | `pm2 restart omni-api`; `pm2 logs omni-api`; `omni status`; check DB URL in `~/.omni/server-config.json` |
| `omni connect` fails: "Failed to discover agent" | `genie dir ls` — if missing: `genie dir add <name> --dir /path/to/agent` |
| Messages arrive, agent never replies | `genie serve status` (bridge up?); `genie events list --since 5m` + `genie events errors`; agent must end every turn with `omni done`; filter mismatch: `omni instances get <id> --json \| jq .agentReplyFilter` |
| agentId still null after connect | `omni agents list` for the agent UUID → `omni instances update <id> --agent-fk-id <uuid>`; if no agent record exists, re-run `omni connect` |
| QR expired / won't scan | `omni instances qr <id>` regenerates (~60s lifetime); prefer `omni instances pair <id> --phone +55...` |
