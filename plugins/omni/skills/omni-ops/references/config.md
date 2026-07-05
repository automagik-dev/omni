# Config, Auth, Keys, Service & Debug

## Auth

```bash
omni auth login --api-key <key> --api-url http://localhost:8882 --json
omni auth status --json
omni auth recover --json             # recover API key via local PM2 access; add --rotate to rotate
omni auth logout
```

## CLI config

```bash
omni config list --json              # keys: apiUrl, apiKey, defaultInstance, format, showCommands, telemetry
omni config get defaultInstance --json
omni config set defaultInstance <id> --json
omni config unset <key>
```

## API keys

```bash
omni keys create --name agent-key --profile coworker --json    # profile templates: cs|personal|scout|coworker|... (--scopes is legacy)
omni keys list --status active --limit 50 --json               # status: active|revoked|expired
omni keys get <id> --json
omni keys revoke <id> --reason "rotation" --json
omni keys delete <id>                                          # permanent — confirm with the user first
```

## Server settings

```bash
omni settings list --category ai --json
omni settings get <key> --json
omni settings set <key> <value> --reason "ops update" --json
```

## Service management

```bash
omni status --json                   # API health + connection info
omni start
omni stop
omni restart
omni update -y --no-restart          # update CLI to latest
omni doctor                          # diagnose and repair the embedded runtime
```

## Logs

```bash
omni logs error --limit 50           # positional level: debug|info|warn|error
omni logs --modules api,nats --limit 100
omni logs --process api --follow     # stream PM2 process logs live
```

## Dead letters (failed events)

```bash
omni dead-letters list --status pending --limit 50 --json   # status: pending|retrying|resolved|abandoned
omni dead-letters stats --json
omni dead-letters get <id> --json
omni dead-letters retry <id> --json
omni dead-letters resolve <id> --note "fixed manually" --json
omni dead-letters abandon <id>       # stops retries — confirm with the user first
```

## Payloads (per-event stage snapshots)

```bash
omni payloads list <eventId> --json
omni payloads get <eventId> agent_response --json   # stages: webhook_raw|agent_request|agent_response|channel_send|error
omni payloads stats --json
omni payloads config --retention 30 --json          # storage toggles: --store-webhook, --store-agent-request, ...
```
