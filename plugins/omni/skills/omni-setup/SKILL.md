---
name: omni-setup
description: "Get Omni running from scratch — install, connect WhatsApp, plug your agent, verify. Zero to messaging in 4 steps."
allowed-tools: Bash(omni *), Bash(genie *), Bash(pm2 *)
---

# Omni Setup — Zero to Messaging in 4 Steps

End-to-end guide for getting Omni installed, a channel connected, an agent plugged in, and messages flowing. Follow the steps in order — each builds on the previous one.

## Quick Start

### Step 1: Install

Check if Omni is already running:

```bash
omni auth status
```

If this returns a valid connection, skip to Step 2.

If Omni is not installed or not running, run the interactive setup wizard:

```bash
omni install
```

The wizard handles everything: system checks, NATS download, process manager selection (PM2 recommended), port configuration, API key generation, and service startup. It writes config to `~/.omni/config.json` automatically.

For scripted/CI installs, use non-interactive mode:

```bash
omni install --non-interactive
```

After install, verify the server is healthy:

```bash
omni status
```

### Step 2: Connect Channel

List existing channel instances:

```bash
omni instances list
```

If you already have an instance with status `connected`, skip to Step 3.

If no instances exist, start the WhatsApp connection flow:

```bash
omni start
```

This starts the Omni server and displays a QR code in the terminal. Scan the QR code with your WhatsApp mobile app (Settings > Linked Devices > Link a Device).

After scanning, verify the instance appeared and is connected:

```bash
omni instances list
```

You should see your instance with status `connected`. Note the instance ID — you will need it for the next step.

For other channels (Telegram, Discord, Slack), refer to the specific channel documentation and use `omni instances create` with the appropriate provider.

### Step 3: Plug Agent

Connect your Omni instance to a Genie agent with a single command:

```bash
omni connect <instance-id> <agent-name>
```

This command does four things automatically:
1. Discovers the agent from the Genie directory (`genie dir ls <agent-name>`)
2. Creates a NATS-Genie provider for the agent (schema `nats-genie`)
3. Creates an Omni agent record linked to the provider
4. Updates the instance with the agentId (FK), agentProviderId, agentReplyFilter, and triggerMode

**Flags:**

| Flag | Default | Behavior |
|------|---------|----------|
| `--mode <mode>` | `turn-based` | `turn-based` (round-trip; agent ends each turn with `omni done`) or `fire-and-forget` (Omni publishes and does not wait) |
| `--reply-filter <filter>` | `all` | `all` reply to every inbound message; `filtered` apply `agentReplyFilter.conditions` (DM, mention, reply, name-match) |
| `--nats-url <url>` | `localhost:4222` | NATS server URL used by the provider for publish/subscribe |

> **⚠️ Reply filter default — `all` means "reply to everything."** On WhatsApp this includes every group and broadcast the account is in. If the instance will join groups, pass `--reply-filter filtered` at connect time, or tighten later with:
> ```bash
> omni instances update <id> --reply-filter-mode filtered --reply-on-dm
> ```
> A **null/missing** `agentReplyFilter` also allows every message through (behavior change introduced in automagik-dev/omni#371 — previously null silently dropped every message). The API logs a one-time warning per instance when a null filter is detected.

The agent must be registered in the Genie directory first. If it is not, register it:

```bash
genie dir add <agent-name> --dir /path/to/agent
```

### Step 4: Start Bridge

Start the Genie server. The NATS ↔ agent bridge (`OmniBridge`) is instantiated inside `genie serve start` automatically — there is **no** `genie omni start` command.

```bash
genie serve start
```

When a message arrives on the connected instance, the bridge:
1. Receives the message event from NATS (`omni.message.<instance-id>.<chat-id>`)
2. Routes to the configured Genie agent (spawning a session if needed)
3. Sets environment variables (`OMNI_INSTANCE`, `OMNI_CHAT`, `OMNI_MESSAGE`, `OMNI_AGENT`)
4. The agent processes the message and replies using verb commands (`omni say`, `omni speak`, etc.), publishing on `omni.reply.<instance-id>.<chat-id>`
5. In `turn-based` mode the agent signals completion with `omni done`

Verify the bridge is live:

```bash
genie serve status
```

For long-running deployments, keep `genie serve` under a process manager:

```bash
pm2 start "genie serve start" --name genie-serve
pm2 save
```

### NATS topic contract

The `nats-genie` provider and the genie `OmniBridge` communicate over plain NATS subjects. Understanding the contract makes debugging straightforward — you can subscribe to any subject with `nats sub '<pattern>'`.

| Direction | Subject | Purpose |
|-----------|---------|---------|
| Omni → Genie | `omni.message.<instance-id>.<chat-id>` | Inbound user message payload (content, sender, files, env) |
| Genie → Omni | `omni.reply.<instance-id>.<chat-id>` | Agent-generated reply delivered back to the channel |
| Omni → Genie | `omni.session.reset.<instance-id>.<chat-id>` | `{ action: 'kill' }` — drop the agent's in-memory session for this chat |
| Omni → Genie (turn lifecycle) | `omni.turn.{open,done,nudge,stalled,timeout}.<instance-id>.<chat-id>` | Real-time turn signals for `turn-based` mode |

**Important:** Omni subscribes to `omni.reply.<instance-id>.>` (recursive wildcard). WhatsApp chat IDs contain dots (e.g. `5511999999999@s.whatsapp.net`), which the single-token wildcard `*` does not match. See `docs/migration/nats-genie-sidecar-decommission.md`.

## Verify

After completing all four steps, verify the full pipeline is working.

Check your active instance and chat context:

```bash
omni where
```

Verify the agent is assigned to the instance (agentId should not be null):

```bash
omni instances get <instance-id>
```

Verify the agent appears in Genie after receiving its first message:

```bash
genie ls --source omni
```

Set your working context and send a test message:

```bash
omni use <instance-id>
omni open <chat-jid>
omni say "test"
```

If the agent is running, you should see a reply appear in the chat.

## Troubleshooting

### NATS not running

Symptom: Bridge fails to start or logs connection refused errors.

```bash
pm2 list                  # Check if omni-nats process exists and is online
pm2 restart omni-nats     # Restart NATS server
pm2 logs omni-nats        # Check NATS logs for errors
```

If NATS was never started, the `omni install` wizard may not have completed fully. Start it manually:

```bash
~/.omni/nats-server -js -sd ~/.omni/data/nats
```

### PG not reachable

Symptom: API returns 500 errors or the bridge starts in degraded mode.

```bash
pm2 restart omni-api      # Restart the Omni API server
pm2 logs omni-api         # Check API server logs
omni status               # Verify API health endpoint
```

Check that the database URL in `~/.omni/server-config.json` is correct and the PostgreSQL server is running.

### Agent not found in directory

Symptom: `omni connect` fails with "Failed to discover agent" error.

```bash
genie dir ls              # List all registered agents
genie dir add <name> --dir /path/to/agent   # Register the agent
```

The agent directory path must contain the agent's configuration files (CLAUDE.md, AGENTS.md, or equivalent).

### No reply from agent

Symptom: Messages arrive but the agent never responds.

```bash
genie events list --since 5m   # Check recent events for errors
genie ls                       # Check if the agent process is running
pm2 logs omni-bridge           # Check bridge logs for delivery errors
```

Common causes:
- The bridge is not running — start it with `genie serve start` (verify with `genie serve status`)
- The agent crashed during processing — check `genie events errors`
- The agent does not have a turn-based prompt — ensure the agent calls `omni done` at the end of each turn
- The reply filter is set to `filtered` but no filter conditions match (e.g. `onDm: true` in a group chat) — inspect with `omni instances get <id> --json | jq .agentReplyFilter`

### agentId still null after connect

Symptom: `omni instances get <id>` shows agentId as null even after running `omni connect`.

This can happen if the API update call failed silently. Set the agent ID manually:

```bash
omni instances update <instance-id> --agent-fk-id <agent-uuid>
```

To find the agent UUID:

```bash
omni agents list          # Find the agent record created by connect
```

Then update the instance with the correct ID. If the agent record is also missing, re-run `omni connect` or create the agent manually via the API.

### QR code expired or not scanning

Symptom: WhatsApp QR code disappears or phone cannot scan it.

```bash
omni instances qr <instance-id>   # Regenerate QR code
```

Make sure your phone has a stable internet connection and WhatsApp is up to date. The QR code expires after approximately 60 seconds — scan it promptly after it appears.
