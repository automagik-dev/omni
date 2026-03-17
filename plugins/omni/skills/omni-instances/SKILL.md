---
name: omni-instances
description: |
  Operate Omni channel instances: lifecycle, QR/pairing, sync jobs, contacts/groups, profile/privacy, history backfill via resync, auto-ack, debounce, and agent dispatch options.
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Instances

## Discovery and lifecycle

```bash
omni instances list --json
omni instances list --channel whatsapp-baileys --status connected --json
omni instances get <id> --json
omni instances create --name "Ops WA" --channel whatsapp-baileys --json
omni instances update <id> --name "Ops WA Prod" --json
omni instances delete <id> --json

omni instances status <id> --json
omni instances whoami <id> --json
omni instances connect <id> --json
omni instances disconnect <id> --json
omni instances restart <id> --force-new-qr --json
omni instances logout <id> --json
```

## Auto-ack (reaction acknowledgement)

Acknowledge incoming messages with a reaction before the agent responds. Gives users instant feedback that their message was received.

```bash
# Enable reaction ack
omni instances update <id> --reaction-ack on --json

# Disable reaction ack
omni instances update <id> --reaction-ack off --json

# Custom per-channel emoji map (JSON object)
omni instances update <id> --reaction-ack on --reaction-ack-emoji '{"whatsapp":"⏳","discord":"⏳","telegram":"⏳","slack":"eyes"}' --json

# Set ack timeout (ms) — remove reaction after agent responds
omni instances update <id> --ack-timeout 30000 --json
```

Flags (available on `create` and `update`):
- `--reaction-ack <on|off>` — enable/disable reaction acknowledgement
- `--reaction-ack-emoji <json>` — per-channel emoji map as JSON (e.g., `{"whatsapp":"⏳"}`)
- `--ack-timeout <ms>` — timeout in milliseconds before ack reaction is removed

The `agentAckMessage` field (set via API) sends a text auto-reply before agent dispatch — e.g., "Thinking..." — as a fire-and-forget pre-dispatch message.

## Agent session strategy

Controls how the agent groups conversation context.

```bash
# One session per user per chat (default for group chats)
omni instances update <id> --agent-session-strategy per_user_per_chat --json

# One session per user (across all chats)
omni instances update <id> --agent-session-strategy per_user --json

# One session per chat (all users share context)
omni instances update <id> --agent-session-strategy per_chat --json
```

Flag: `--agent-session-strategy <per_user|per_chat|per_user_per_chat>`

## Message format mode

Controls how messages are formatted before being sent to the agent.

```bash
# Convert markdown/formatting to channel-native format (default)
omni instances update <id> --message-format-mode convert --json

# Pass raw message through without conversion
omni instances update <id> --message-format-mode passthrough --json
```

Flag: `--message-format-mode <convert|passthrough>`

## Debounce

Group rapid successive messages into a single agent dispatch. Useful for users who send multiple short messages in sequence.

```bash
# Enable fixed debounce (wait 3s after last message)
omni instances update <id> --debounce-mode fixed --debounce-min 3000 --json

# Randomized debounce (between min and max)
omni instances update <id> --debounce-mode randomized --debounce-min 2000 --debounce-max 5000 --json

# Separate debounce for group chats
omni instances update <id> --debounce-mode fixed --debounce-min 3000 --debounce-group 5000 --json

# Restart debounce timer when user is typing
omni instances update <id> --debounce-mode fixed --debounce-min 3000 --debounce-restart-on-typing --json

# Disable debounce
omni instances update <id> --debounce-mode disabled --json
```

Flags (available on `create` and `update`):
- `--debounce-mode <disabled|fixed|randomized>` — debounce strategy
- `--debounce-min <ms>` — minimum debounce delay in milliseconds
- `--debounce-max <ms>` — maximum debounce delay (for `randomized` mode)
- `--debounce-group <ms>` — override debounce for group chats (use `"null"` to inherit)
- `--debounce-restart-on-typing` / `--no-debounce-restart-on-typing` — restart timer on typing indicator

## WhatsApp connect

**Pairing code is the preferred method** — works directly in the terminal with no camera needed.
The user just types an 8-digit code into WhatsApp. Use QR only as a fallback.

### Recommended workflow (pairing code)

```bash
# 1. Create the instance
omni instances create --name "WhatsApp" --channel whatsapp-baileys --json

# 2. Start the connection (generates session, prepares for auth)
omni instances connect <id> --json

# 3. Request a pairing code (ask the user for their phone number in international format: +XXXXXXXXXXX)
omni instances pair <id> --phone <number> --json
# Returns an 8-digit pairing code like XXXX-XXXX

# 4. Tell the user:
#    "Enter XXXX-XXXX in WhatsApp > Settings > Linked Devices > Link with phone number"

# 5. Wait ~15 seconds for WhatsApp to complete the link, then verify:
omni instances status <id> --json
# Expected: status "connected"
```

### Fallback: QR code

If pairing code does not work, fall back to QR:

```bash
omni instances qr <id> --json
# QR auto-refreshes by default. Use --no-watch for a single static QR.
```

## Sync and backfill

```bash
omni instances sync <id> --type messages --depth 30d --download-media --json
# Sync a specific chat (WhatsApp only)
omni instances sync <id> --type messages --chat <jid> --json
omni instances syncs <id> --limit 20 --json
omni instances syncs <id> <jobId> --json

omni resync --instance <id> --since 2h --json
omni resync --all --since 1h --dry-run --json
```

## Contacts, groups, profile

```bash
omni instances contacts <id> --limit 100 --search "Felipe" --json
omni instances groups <id> --search "team" --json
omni instances profile <id> <userId> --json
omni instances check <id> +5511999 --json
omni instances update-bio <id> "Available" --json
omni instances privacy <id> --json

# Profile pictures
omni instances update-picture <id> --url "https://example.com/pic.jpg" --json
omni instances update-picture <id> --base64 "<data>" --json
omni instances remove-picture <id> --json
omni instances group-update-picture <id> --group <groupJid> --url "https://example.com/pic.jpg" --json

# Reject incoming call
omni instances reject-call <id> --call-id <callId> --from <jid> --json
```

## Access control (`omni access`)

Manage allow/deny lists per instance. Works with `accessMode` on the instance (`allowlist`, `blocklist`, or `disabled`).

```bash
# List rules (optionally filter by instance or type)
omni access list --json
omni access list --instance <id> --json
omni access list --instance <id> --type allow --json

# Create allow or deny rule
omni access create --type allow --instance <id> --phone <number> --reason "description" --json
omni access create --type deny --instance <id> --phone <number> --reason "description" --json
# Options: --user <platformId>, --phone <pattern> (supports * wildcard, e.g. +55*),
#          --priority <n>, --action block|silent_block|allow, --message "custom block msg", --disabled

# Delete a rule
omni access delete <ruleId> --json

# Get or set access mode for an instance
omni access mode <instanceId> --json              # get current mode
omni access mode <instanceId> allowlist --json     # set to allowlist
omni access mode <instanceId> blocklist --json     # set to blocklist
omni access mode <instanceId> disabled --json      # disable access control

# Check if a user has access
omni access check --instance <id> --user <platformUserId> --json

# Pairing requests (users requesting access)
omni access pending <instanceId> --json
omni access approve <instanceId> <requestId> --json   # adds user to allowlist
omni access deny <instanceId> <requestId> --reason "not authorized" --json
```

## Moderation and group ops

```bash
omni instances block <id> <contactId> --json
omni instances unblock <id> <contactId> --json
omni instances blocklist <id> --json

omni instances group-create <id> --subject "Team" --participants +5511999 +5511888 --json
omni instances group-invite <id> <groupJid> --json
omni instances group-revoke-invite <id> <groupJid> --json
omni instances group-join <id> <inviteCode> --json
```
