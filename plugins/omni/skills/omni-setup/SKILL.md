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
2. Creates a NATS-Genie provider for the agent
3. Creates an Omni agent record linked to the provider
4. Updates the instance with the agentId (FK), agentProviderId, replyFilter, and triggerMode

The default trigger mode is `turn-based` (round-trip), meaning the agent processes one message at a time and signals completion with `omni done`. For fire-and-forget mode (agent receives messages but Omni does not wait for a reply signal):

```bash
omni connect <instance-id> <agent-name> --mode fire-and-forget
```

Other options:

```bash
omni connect <instance-id> <agent-name> --reply-filter filtered   # Only reply to messages matching filter conditions
omni connect <instance-id> <agent-name> --nats-url custom:4222    # Custom NATS server URL (default: localhost:4222)
```

The agent must be registered in the Genie directory first. If it is not, register it:

```bash
genie dir add <agent-name> --dir /path/to/agent
```

### Step 4: Start Bridge

Start the NATS-to-Genie bridge that delivers messages from Omni to your agent:

```bash
genie omni start --executor sdk
```

This bridges NATS message events to the Genie agent. When a message arrives on the connected WhatsApp instance, the bridge:
1. Receives the message event from NATS (`omni.message.<instance-id>.*`)
2. Spawns or routes to the configured Genie agent
3. Sets environment variables (`OMNI_INSTANCE`, `OMNI_CHAT`, `OMNI_MESSAGE`, `OMNI_AGENT`)
4. The agent processes the message and replies using verb commands (`omni say`, `omni speak`, etc.)
5. The agent signals completion with `omni done`

The bridge runs as a long-lived process. Use PM2 to keep it running in the background:

```bash
pm2 start "genie omni start --executor sdk" --name omni-bridge
pm2 save
```

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
- The bridge is not running — start it with `genie omni start --executor sdk`
- The agent crashed during processing — check `genie events errors`
- The agent does not have a turn-based prompt — ensure the agent calls `omni done` at the end of each turn
- The reply filter is set to `filtered` but no filter conditions are configured — use `--reply-filter all`

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
