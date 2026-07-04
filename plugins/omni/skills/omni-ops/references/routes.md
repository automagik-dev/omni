# Routes — Per-Chat / Per-User Agent Routing

Routes override instance-level agent config for matched conversations. Scope is `chat` or `user`; the highest-priority matching route wins. A route binds an agent via `--agent <agentId>` — there is no `--provider` flag; the backend comes from the agent record.

## Commands

```bash
omni routes list --instance <id> --active --json
omni routes get <routeId> --instance <id> --json

omni routes create --instance <id> --scope chat --chat <chatId> --agent <agentId> \
  --label "Support" --priority 10 --json
omni routes create --instance <id> --scope user --person <personId> --agent <agentId> --json
omni routes create --instance <id> --scope chat --chat <chatId> --agent <agentId> \
  --gate --gate-prompt "Reply only if this is a support request" --json

omni routes update <routeId> --instance <id> --label "New label" --priority 20 --json
omni routes update <routeId> --instance <id> --active --json      # or --inactive
omni routes delete <routeId> --instance <id> --json

omni routes test --instance <id> --chat <chatId> --json           # which route resolves?
omni routes test --instance <id> --person <personId> --json
omni routes metrics --json                                        # route cache metrics
```

Per-route behavior flags (`omni routes create --help`): `--timeout <s>`, `--stream/--no-stream`, `--prefix-sender`, `--wait-media`, `--send-media-path`, `--gate/--no-gate`, `--gate-model`, `--gate-prompt`, `--reply-filter-mode all|filtered`.

## Patterns

```bash
# Which route applies to this chat?
omni routes test --instance <id> --chat <chatId> --json | jq '{route: .id, agent: .agentId, priority: .priority}'

# Active routes overview
omni routes list --instance <id> --active --json | jq '.[] | {id, label, scope, priority}'
```
