---
name: omni-automations
description: "Build and manage event-driven automations: trigger events, conditions, ordered actions, testing and execution evidence."
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Automations

## When to Use

Build or debug an event-driven workflow, including message handlers, agent calls, webhooks, sends, event emissions and logs.

## Flow

1. Read [ground rules](../omni-ops/references/ground-rules.md) and [automation operations](../omni-ops/references/automations.md). Discover options with `omni automations --help` and the relevant action's help; custom ingress uses [webhooks](../omni-ops/references/webhooks.md). Idle-chat follow-up has a separate surface: `omni follow-up --help`.
2. Inspect `omni automations list --json` and observed trigger types via `omni events list --json`; update an existing workflow instead of duplicating it.
3. Create disabled, then mock-test with `omni automations test <id> --event '<json>'`. Without `--execute`, testing runs no actions.
4. With authorization, enable, trigger a real event and confirm a matching successful action in `omni automations logs <id>`.

## Rules

- Report the automation ID, final JSON configuration and test/log output verbatim. Claim working execution only after a log confirms it fired and the action succeeded.
- Both `test --execute` and `execute` run real actions and need authorization. Disabled events are skipped; replay on enable is an explicit real action.
- If the trigger type is absent from observed events, report it instead of guessing. If a condition still mismatches after one fix, return the payload and condition JSON.
- After two consecutive create/update failures, stop with the exact CLI error.
