# Config, Auth, Keys, Service & Debug

## Remote server registry

```bash
omni server list --json                      # masked credentials; do not use --reveal in logs
omni server current --json
omni server add <name> <url>                  # no key: starts owner-approved device sign-in
omni server use <name>                       # persist the active server
omni status --server <name> --json            # one-command target override
omni server remove <name>                    # switch away first if active
```

Keyless `server add` shows a device approval code and link, waits for owner approval, and saves the resulting key in that entry. If device sign-in is unavailable, it can save a new entry without a key; use an existing credential to sign in instead. Owner-approved device keys work with CLI validation without adding `auth:validate` or expanding permissions. `claim`, `approve`, and bare `connect` are privileged operator actions requiring an existing `auth:admin` key, not agent self-service (setup skill).

Remote registry entries are distinct from `server.*`, which configure the locally supervised runtime. Manage `servers.*` through `omni server`, not `omni config set`; `servers.active` is a read-only row in config list.

## Auth

```bash
omni auth login                              # no key input/env fallback: device sign-in to current server
omni auth login --server <name>              # same flow for a saved entry
omni auth login --api-url http://localhost:8882 --json --api-key-stdin < /secure/path/omni-api-key
omni auth status --json
omni auth recover --json             # recover API key via local PM2 access; add --rotate to rotate
omni auth logout
```

Use a terminal for owner-approved device sign-in. For scripts or an existing credential, prefer a protected-file redirect as above or a secret-manager pipe. `auth login` saves the approved or validated key in the targeted server entry; `auth logout` clears that entry's credentials. With an already securely supplied `OMNI_CLI_API_KEY`, `omni auth login --server <name>` needs no key flag. Explicit `--api-key-stdin` or legacy `--api-key` overrides the environment; those flags are mutually exclusive. Do not paste secrets into commands, shell history, or chat. Stdin must contain one non-empty key, at most 8 KB including its optional trailing LF/CRLF.

`OMNI_API_KEY` is the API server's primary key and is ignored by login. Only
`OMNI_CLI_API_KEY` is used as the CLI environment fallback. Stdin is limited to
8 KB including the optional trailing LF/CRLF. A successful login reports
`keySource` as `device`, `flag`, `stdin`, or `env`, without printing the key.

## CLI config

```bash
omni config list --json              # includes updateChannel, server.* and read-only servers.active
omni config get defaultInstance --json
omni config set defaultInstance <id> --json
omni config unset <key>
```

`config list` enumerates the installed keys. Alongside client defaults it includes `server.port`, `server.databaseUrl`, `server.dataDir`, `server.logLevel`, `server.nodeEnv`, `server.natsHost`, `server.publicUrl`, and `server.login`. Runtime changes apply through the appropriate authorized start/install/update path. `auth status` can fail on credentials or scope even when the API is healthy; don't turn that error into an install/restart recommendation. `auth recover` is privileged local PM2 recovery, not remote sign-in.

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
omni doctor                          # diagnostics; inspect --help before opting into repairs
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

For isolated runtimes, desktop setup, host trust, tenancy and audit, discover the separate surfaces with `omni sandbox --help`, `omni desktop --help`, `omni trust --help`, `omni tenants --help`, `omni multitenancy --help` and `omni audit --help`. Trust/tenant changes need an explicit authorized scope; they are not auth troubleshooting shortcuts.
