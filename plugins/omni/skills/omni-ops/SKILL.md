---
name: omni-ops
description: "Platform operations — instances, routes, providers, config, events, automations, webhooks, prompts, contacts, batch processing."
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Ops

Admin operations for a running Omni platform. Match the request against the routing table, read that reference file, run the commands there. Add `--json` to anything you parse; extract fields with `jq`.

Install, channel pairing, agent plugging (`omni connect`), and bridge troubleshooting are NOT here — that flow is canonical in `../omni-setup/SKILL.md`. Conversation verbs (`say`, `speak`, `done`, ...) live in `../omni-agent/SKILL.md`.

## Keyword routing

| Keywords | Reference |
|----------|-----------|
| instances, connect, disconnect, QR, pair, sync, resync, contacts, groups, profile, debounce, access, allowlist | [references/instances.md](references/instances.md) |
| routes, routing, agent route, reply filter, gate, scope, priority | [references/routes.md](references/routes.md) |
| providers, agent providers, create provider, schema, genie, claude-code, a2a, ag-ui, agno, openclaw, webhook provider | [references/providers.md](references/providers.md) |
| config, settings, API keys, server, auth, logs, dead letters, payloads, service, doctor | [references/config.md](references/config.md) |
| events, analytics, timeline, replay, trace, journey, metrics | [references/events.md](references/events.md) |
| automations, triggers, workflows, conditions, enable, disable | [references/automations.md](references/automations.md) |
| webhooks, custom events, event source, trigger | [references/webhooks.md](references/webhooks.md) |
| prompts, LLM prompt, gate prompt, image prompt, media description, TTS prompt | [references/prompts.md](references/prompts.md) |
| persons, contacts, search person, presence, phone, merge identity | [references/persons.md](references/persons.md) |
| batch, transcribe, extract, media processing, redownload, estimate | [references/batch.md](references/batch.md) |

## Ground rules

- Reads are free: run `list` / `get` / `status` / `test` / `estimate` without asking.
- Pause for the user before destructive or irreversible ops: `instances delete`, `instances logout`, `keys delete`, `persons merge`, `dead-letters abandon`, `automations execute` against production traffic, access-mode flips on live instances, large batch jobs.
- Report verified outcomes — what the command actually returned, not what you intended. A change counts as done when a follow-up read confirms it.

## Quick health check

```bash
omni status --json                     # API health
omni auth status --json                # credentials valid?
omni instances list --status connected --json | jq '.[] | {id, name, channel}'
omni dead-letters stats --json         # failed-event backlog
```
