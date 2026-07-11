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

## Examples (verified)

```bash
omni auth login --api-key <key> --api-url http://localhost:8882
omni config set defaultInstance <id>
omni status
```

API keys, server settings, logs, dead letters, auth recovery: omni-ops skill § Config.
