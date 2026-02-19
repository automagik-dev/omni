---
name: omni-automations
description: |
  Create and manage event-driven automations in Omni — define triggers, actions, conditions, enable/disable, test with dry-run, and view execution logs.
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Automations

Create and manage event-driven workflows using `omni automations`.

## Create Automation

```bash
omni automations create \
  --name "Support Bot" \
  --trigger message.received \
  --action call_agent \
  --agent-id support-agent \
  --response-as agentResponse
```

### With Conditions

```bash
omni automations create \
  --name "Urgent Filter" \
  --trigger message.received \
  --action call_agent \
  --agent-id urgent-handler \
  --condition '[{"field":"messageType","operator":"equals","value":"text"}]' \
  --condition-logic "and"
```

### Forward Action

```bash
omni automations create \
  --name "Forward to Team" \
  --trigger message.received \
  --action forward \
  --action-config '{"targetChat":"team-chat-id"}'
```

## List Automations

```bash
omni automations list
omni automations list --json
```

## Get Automation Details

```bash
omni automations get <id>
```

## Update Automation

```bash
omni automations update <id> --name "New Name"
```

## Enable / Disable

```bash
omni automations enable <id>
omni automations disable <id>
```

## Test (Dry Run)

```bash
omni automations test <id>
omni automations test <id> --dry-run
```

## Execute Manually

```bash
omni automations execute <id>
```

## View Logs

```bash
omni automations logs <id>
omni automations logs <id> --json
```
