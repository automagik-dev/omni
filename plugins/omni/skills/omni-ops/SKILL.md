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
| providers, agent providers, create provider, schema, genie, claude-code, a2a, ag-ui, agno, webhook provider | [references/providers.md](references/providers.md) |
| config, settings, API keys, server, auth, logs, dead letters, payloads, service, doctor | [references/config.md](references/config.md) |
| events, analytics, timeline, replay, trace, journey, metrics | [references/events.md](references/events.md) |
| automations, triggers, workflows, conditions, enable, disable | [references/automations.md](references/automations.md) |
| webhooks, custom events, event source, trigger | [references/webhooks.md](references/webhooks.md) |
| prompts, LLM prompt, gate prompt, image prompt, media description, TTS prompt | [references/prompts.md](references/prompts.md) |
| persons, contacts, search person, presence, phone, merge identity | [references/persons.md](references/persons.md) |
| batch, transcribe, extract, media processing, redownload, estimate | [references/batch.md](references/batch.md) |

## Ground rules

- Within the authorized task, use `list` / `get` / `status`, estimates and dry-run tests to inspect state. `automations test --execute` runs real actions; it has the same effect boundary as `automations execute`. Following a durable consumer normally advances its cursor; `events follow --no-ack` omits acknowledgement but still pulls (and can claim a shared lease). Use consumer `inspect` for metadata-only reads.
- Pause for the user before destructive or irreversible ops: `instances delete`, `instances logout`, `keys delete`, `persons merge`, `dead-letters abandon`, `automations execute` against production traffic, access-mode flips on live instances, large batch jobs.
- Report verified outcomes — what the command actually returned, not what you intended. A change counts as done when a follow-up read confirms it.

## Additional management groups

Use the installed CLI's group help for capabilities not expanded in these references:

| Intent | Discovery |
|--------|-----------|
| Remote server selection / credentials | `omni server --help`, `omni auth --help`; config reference |
| Local isolated runtime / desktop app | `omni sandbox --help`, `omni desktop --help`; setup skill |
| Channel event contracts | `omni channels capabilities --help` |
| Agent definitions / accepts-publishes manifest | `omni agents --help`, `omni agents manifest --help` |
| Connectors / GitHub and other sources | `omni connectors --help`, `omni sources --help` |
| Host trust / tenancy | `omni trust --help`, `omni tenants --help`, `omni multitenancy --help` |
| Turn, audit and follow-up management | `omni turns --help`, `omni audit --help`, `omni follow-up --help` |
| Slack-specific operations | `omni slack --help` |

These are discovery paths, not blanket permission to change trust, scope, tenancy or live traffic. The CLI cannot pair itself keylessly: `server add` only registers a URL; an API key is still required. Operator `claim`/`approve`/bare `connect` require an existing `auth:admin` key (setup skill).

## Quick health check

```bash
omni server current --json             # verify target; --server <name> selects per command
omni status --json                     # API health
omni auth status --json                # validation scope/credential errors are not server downtime
omni instances list --status connected --json | jq '.[] | {id, name, channel}'
omni dead-letters stats --json         # failed-event backlog
```
