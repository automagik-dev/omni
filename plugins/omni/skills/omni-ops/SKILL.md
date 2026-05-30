---
name: omni-ops
description: "Platform operations — instances, routes, providers, config, events, automations, webhooks, prompts, contacts, batch processing."
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Ops

Admin and power-user skill covering all Omni infrastructure operations.

## Keyword Routing

Find the right section by matching your intent:

| Keywords | Section |
|----------|---------|
| instances, connect, disconnect, QR, pair, sync, resync, contacts, groups, profile, debounce, access | [Instances](#instances) |
| routes, routing, agent route, reply filter, gate, scope | [Routes](#routes) |
| providers, agent providers, create provider, schema, genie, claude-code, a2a, ag-ui, agno, webhook | [Providers](#providers) |
| config, settings, API keys, server, auth, logs, dead letters, payloads, service | [Config](#config) |
| events, analytics, timeline, replay, trace, journey, metrics | [Events](#events) |
| automations, triggers, workflows, conditions, enable, disable | [Automations](#automations) |
| webhooks, custom events, event source, trigger | [Webhooks](#webhooks) |
| prompts, LLM prompt, gate prompt, image prompt, media description | [Prompts](#prompts) |
| persons, contacts, search person, presence, phone | [Persons](#persons) |
| batch, transcribe, extract, media processing, redownload, estimate | [Batch](#batch) |

---

## Instances

Manage channel instances — lifecycle, connection, sync, contacts, groups, profile, debounce, and access control. Each instance represents one connected channel account (WhatsApp, Telegram, etc.).

### Key commands

```bash
# Discovery and lifecycle
omni instances list --json
omni instances list --channel whatsapp-baileys --status connected --json
omni instances get <id> --json
omni instances create --name "Ops WA" --channel whatsapp-baileys --json
omni instances delete <id> --json

# Connection management
omni instances status <id> --json
omni instances connect <id> --json
omni instances disconnect <id> --json
omni instances restart <id> --force-new-qr --json

# WhatsApp pairing (preferred over QR)
omni instances pair <id> --phone +5511999999999 --json
omni instances qr <id> --json

# Sync and backfill
omni instances sync <id> --type messages --depth 30d --download-media --json
omni instances syncs <id> --limit 20 --json
omni resync --instance <id> --since 2h --json
omni resync --all --since 1h --dry-run --json

# Contacts and groups
omni instances contacts <id> --limit 100 --search "Example User" --json
omni instances groups <id> --search "team" --json
omni instances check <id> +5511999 --json

# Instance config (debounce, ack, session strategy)
omni instances update <id> --reaction-ack on --json
omni instances update <id> --debounce-mode fixed --debounce-min 3000 --json
omni instances update <id> --agent-session-strategy per_user_per_chat --json

# Access control
omni access list --instance <id> --json
omni access create --type allow --instance <id> --phone +5511999 --reason "VIP" --json
omni access create --type deny --instance <id> --phone +5511888 --reason "spam" --json
omni access mode <id> allowlist --json
omni access check --instance <id> --user <platformUserId> --json
```

### Patterns

```bash
# List all connected instances as agent-consumable JSON
omni instances list --status connected --json | jq '.[] | {id, name, channel, status}'

# Full pairing workflow
omni instances create --name "NewWA" --channel whatsapp-baileys --json
omni instances connect <id> --json
omni instances pair <id> --phone +5511999999999 --json
# User enters code in WhatsApp > Settings > Linked Devices > Link with phone number
omni instances status <id> --json
```

---

## Routes

Route specific chats or users to particular providers and agents. Routes override instance-level agent config for matched conversations. Higher priority wins when multiple routes match.

### Key commands

```bash
# List and inspect
omni routes list --instance <id> --json
omni routes list --instance <id> --active --json
omni routes get <routeId> --instance <id> --json

# Create routes
omni routes create --instance <id> --scope chat --chat <chatId> --provider <providerId> --agent <agentId> --label "Support" --priority 10 --json
omni routes create --instance <id> --scope user --person <personId> --provider <providerId> --agent <agentId> --json
omni routes create --instance <id> --scope chat --chat <chatId> --provider <providerId> --agent <agentId> --gate --gate-prompt "Only reply if relevant" --json

# Update and delete
omni routes update <routeId> --instance <id> --label "New label" --priority 20 --json
omni routes update <routeId> --instance <id> --active --json
omni routes update <routeId> --instance <id> --inactive --json
omni routes delete <routeId> --instance <id> --json

# Test resolution
omni routes test --instance <id> --chat <chatId> --json
omni routes test --instance <id> --person <personId> --json

# Metrics
omni routes metrics --json
```

### Patterns

```bash
# Find which route applies to a chat
omni routes test --instance <id> --chat <chatId> --json | jq '{route: .id, provider: .providerId, agent: .agentId, priority: .priority}'

# List all active routes with labels
omni routes list --instance <id> --active --json | jq '.[] | {id, label, scope, priority, active}'
```

---

## Providers

Manage AI/agent providers that define how Omni connects to backend services. Supported schemas: `nats-genie`, `claude-code`, `a2a`, `ag-ui`, `agno`, `openclaw`, `webhook`.

### Key commands

```bash
# List and inspect
omni providers list --json
omni providers list --active --json
omni providers get <id> --json

# Create by schema
omni providers create --name "genie-prod" --schema nats-genie --agent-name "omni-agent" --target-agent "team-lead" --team-name "omni-{chat_id}" --json
omni providers create --name "claude-local" --schema claude-code --project-path /home/user/project --max-turns 10 --permission-mode bypassPermissions --json
omni providers create --name "a2a-svc" --schema a2a --base-url https://a2a.example.com --api-key <key> --json
omni providers create --name "agui-svc" --schema ag-ui --base-url https://agui.example.com --api-key <key> --stream --json
omni providers create --name "agno-prod" --schema agno --base-url https://app.agno.com/v1/playground/agents --api-key <key> --json
omni providers create --name "my-webhook" --schema webhook --base-url https://api.example.com/chat --api-key <key> --json

# Update and delete
omni providers update <id> --name "new-name" --timeout 120 --json
omni providers update <id> --active --json
omni providers update <id> --no-active --json
omni providers delete <id> --json

# Test connectivity
omni providers test <id> --json

# Setup wizards (interactive)
omni providers setup genie --non-interactive --agent-name "omni-agent" --target-agent "team-lead" --instance-id <uuid>
omni providers setup openclaw --non-interactive --gateway-url wss://gw.example --gateway-token <tok> --agent-id <agentId>
```

### Patterns

```bash
# List all active providers with schema type
omni providers list --active --json | jq '.[] | {id, name, schema, active}'

# Check provider health before assigning
omni providers test <id> --json | jq '{healthy: .success, latency: .latencyMs}'
```

---

## Config

Runtime configuration — auth, CLI settings, API keys, server settings, service management, logs, dead letters, and payloads.

### Key commands

```bash
# Auth
omni auth login --api-key <key> --api-url http://localhost:8882 --json
omni auth status --json
omni auth recover --api-url http://localhost:8882 --json
omni auth recover --rotate --json

# CLI config
omni config list --json
omni config get defaultInstance --json
omni config set defaultInstance <id> --json

# API keys
omni keys create --name "agent-key" --scopes messages:read,instances:write --instances <id1,id2> --json
omni keys list --status active --limit 50 --json
omni keys revoke <id> --reason "rotation" --json

# Server settings
omni settings list --json
omni settings list --category ai --json
omni settings set <key> <value> --reason "ops update" --json

# Service management
omni status --json
omni start --json
omni stop --json
omni restart --json
omni update -y --no-restart --json

# Logs
omni logs error --limit 50
omni logs --modules api,nats --follow

# Dead letters
omni dead-letters list --status pending --limit 50 --json
omni dead-letters stats --json
omni dead-letters retry <id> --json
omni dead-letters resolve <id> --note "fixed manually" --json

# Payloads
omni payloads list <eventId> --json
omni payloads get <eventId> agent_response --json
omni payloads stats --json
```

### Patterns

```bash
# Full auth health check
omni auth status --json | jq '{authenticated: .authenticated, keyValid: .keyValid, serverUrl: .serverUrl}'

# Scan for unresolved dead letters
omni dead-letters list --status pending --limit 50 --json | jq '.[] | {id, type, error, createdAt}'
```

---

## Events

Query, analyze, and replay Omni events. Use `omni events` for the event stream and `omni journey` for per-message tracing.

### Key commands

```bash
# Query events
omni events list --since 24h --limit 100 --json
omni events list --instance <id> --type message.received --json
omni events list --chat-id <chatId> --since 24h --json
omni events search "error" --since 7d --limit 100 --json
omni events timeline <personId> --limit 100 --json

# Metrics and analytics
omni events metrics --json
omni events analytics --since 7d --json
omni events analytics --instance <id> --all-time --json

# Event replay (reprocess through pipeline)
omni events replay --start --since 24h --types message.received,message.sent --speed 2 --json
omni events replay --start --since 7d --dry-run --json
omni events replay --status <sessionId> --json
omni events replay --cancel <sessionId> --json

# Message replay (catch up missed messages for an agent)
omni replay <instanceId>
omni replay <instanceId> --since 2026-02-27T10:00:00Z

# Journey tracing
omni journey show <correlationId> --json
omni journey summary --since 24h --json
```

### Patterns

```bash
# Get event volume by type for last 24h
omni events analytics --since 24h --json | jq '.eventsByType'

# Trace a specific message end-to-end
omni journey show <correlationId> --json | jq '.steps[] | {stage, status, durationMs}'
```

---

## Automations

Create event-driven workflows that react to Omni events. Automations fire when a trigger event matches conditions, then execute an action (call_agent, webhook, send_message, emit_event, log).

### Key commands

```bash
# List and inspect
omni automations list --json
omni automations list --enabled --json
omni automations get <id> --json

# Create
omni automations create --name "Support Bot" --trigger message.received --action call_agent --agent-id <agentId> --provider-id <providerId> --response-as agentResponse --priority 100 --json
omni automations create --name "Forward" --trigger message.received --action webhook --action-config '{"url":"https://example.com/hook"}' --json
omni automations create --name "Log All" --trigger message.received --action log --condition '[{"field":"messageType","operator":"equals","value":"text"}]' --condition-logic and --json

# Update
omni automations update <id> --name "New Name" --priority 200 --json

# Enable / disable
omni automations enable <id> --json
omni automations disable <id> --json

# Test and execute
omni automations test <id> --event '{"type":"message.received","payload":{}}' --json
omni automations execute <id> --event '{"type":"message.received","payload":{"text":"hi"}}' --json

# Logs and cleanup
omni automations logs <id> --limit 50 --json
omni automations delete <id> --json
```

### Patterns

```bash
# List enabled automations with their triggers
omni automations list --enabled --json | jq '.[] | {id, name, trigger, action, priority}'

# Check recent execution logs for failures
omni automations logs <id> --limit 10 --json | jq '.[] | select(.status == "failed") | {id, error, executedAt}'
```

---

## Webhooks

Manage external webhook endpoints that inject custom events into Omni's event bus. Use webhooks to integrate external systems or test automations with custom payloads.

### Key commands

```bash
# List and inspect
omni webhooks list --json
omni webhooks list --enabled --json
omni webhooks get <id> --json

# Create
omni webhooks create --name "My Webhook" --description "Receives external events" --json
omni webhooks create --name "Secure Hook" --headers '{"X-Webhook-Secret":"my-secret-token"}' --json
omni webhooks create --name "Draft Hook" --disabled --json

# Update
omni webhooks update <id> --name "Renamed Hook" --json
omni webhooks update <id> --enable --json
omni webhooks update <id> --disable --json

# Delete
omni webhooks delete <id> --json

# Trigger custom events
omni webhooks trigger --type "custom.event" --payload '{"key":"value"}' --instance <id> --json
omni webhooks trigger --type "order.created" --payload '{"orderId":"123"}' --instance <id> --correlation-id "req-abc" --json
```

### Patterns

```bash
# List all webhooks with status
omni webhooks list --json | jq '.[] | {id, name, enabled, createdAt}'

# Fire a test event and trace it
omni webhooks trigger --type "test.ping" --payload '{}' --instance <id> --correlation-id "test-001" --json
omni journey show "test-001" --json
```

---

## Prompts

View and override LLM prompt templates used for media description (image, video, document) and gating decisions. These prompts control how Omni describes attachments to LLMs and how gate filters make reply decisions.

### Key commands

```bash
# List all prompts
omni prompts list --json

# Get specific prompt
omni prompts get image --json
omni prompts get video --json
omni prompts get document --json
omni prompts get gate --json

# Set custom prompt
omni prompts set image "Describe this image in detail, including any text visible." --reason "More detail needed" --json
omni prompts set gate "Reply YES if the message is a support request, NO otherwise." --json

# Set from file (multiline)
omni prompts set document < /path/to/prompt.txt --json

# Reset to default
omni prompts reset image --json
omni prompts reset gate --json
```

### Patterns

```bash
# Audit all current prompt overrides
omni prompts list --json | jq '.[] | select(.customized == true) | {name, customized, updatedAt}'

# View the active gate prompt
omni prompts get gate --json | jq '.prompt'
```

---

## Persons

Search and inspect contacts in the Omni person directory. Persons are auto-created from incoming messages — no manual creation needed.

### Key commands

```bash
# Search by name or phone
omni persons search "Example User" --json
omni persons search "+5511999" --limit 5 --json
omni persons search "partial name" --limit 50 --json

# Get full profile
omni persons get <personId> --json

# Check online presence
omni persons presence <personId> --json
```

### Patterns

```bash
# Find a person and check their presence
omni persons search "Example User" --json | jq '.[0] | {id, name, phone}'
omni persons presence <personId> --json | jq '{online: .online, lastSeen: .lastSeen}'

# List all persons matching a phone prefix
omni persons search "+5511" --limit 100 --json | jq '.[] | {id, name, phone}'
```

---

## Batch

Run and monitor batch jobs for media processing — transcription, text extraction, and media redownload. Always estimate costs before creating jobs.

### Key commands

```bash
# Estimate cost first
omni batch estimate --instance <id> --type time_based_batch --days 7 --content-types audio,image --json
omni batch estimate --instance <id> --type targeted_chat_sync --chat <chatId> --limit 200 --json

# Create jobs
omni batch create --instance <id> --type time_based_batch --days 30 --content-types audio,video --limit 500 --json
omni batch create --instance <id> --type targeted_chat_sync --chat <chatId> --limit 200 --json
omni batch create --instance <id> --type media_redownload --days 14 --content-types image,document --force --json

# Monitor and control
omni batch list --instance <id> --status running,failed --limit 50 --json
omni batch status <jobId> --json
omni batch status <jobId> --watch --interval 2000 --json
omni batch cancel <jobId> --json
```

### Patterns

```bash
# Estimate then create a transcription batch
omni batch estimate --instance <id> --type time_based_batch --days 7 --content-types audio --json | jq '{items: .estimatedItems, cost: .estimatedCost}'
omni batch create --instance <id> --type time_based_batch --days 7 --content-types audio --json

# Monitor a running job
omni batch status <jobId> --json | jq '{status, progress: .processedItems, total: .totalItems, errors: .errorCount}'
```
