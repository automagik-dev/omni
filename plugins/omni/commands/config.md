---
description: Omni CLI setup — API key, base URL, default instance. Use for first-run configuration, auth failures (401 / "not configured"), or switching the default instance.
arguments:
  - name: args
    description: Config operation (e.g., set defaultInstance <id>, get apiUrl)
    required: false
---

# /omni:config — CLI Configuration

Use for first-run setup, credential problems, or changing CLI defaults.

## Usage

$ARGUMENTS

## Examples

```bash
omni auth login --api-key <key> --api-url http://localhost:8882
omni config set defaultInstance <id>
omni status
```

For multiple servers, inspect `omni server list --json`, register with `omni server add <name> <url>`, select with `omni server use <name>` or global `--server <name>`, and save a supplied key with `omni auth login --server <name> --api-key <key>`. Login/logout apply to that targeted entry. `server add` without a key only registers the URL; the CLI cannot obtain a device key itself. Operator `claim`/`approve`/bare `connect` require an existing `auth:admin` credential and are not agent self-service. Current device keys also lack the `auth:validate` scope needed by CLI login/status; refer credential problems to the operator rather than widening access.

`omni config list --json` includes `updateChannel`, local `server.*`, and read-only `servers.active`. Remote registry changes use `omni server`, not `config set servers.*`. A failed `auth status` can be credentials/scopes rather than runtime downtime. API keys, server settings, logs, dead letters, auth recovery: omni-ops skill § Config. Inspect `omni server --help` and `omni config --help` for installed options.
