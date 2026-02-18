---
description: Interactive config setup — API key, base URL, default instance
arguments:
  - name: args
    description: Config operation (e.g., set defaultInstance <id>, get apiUrl)
    required: false
---

# /omni:config — Configuration

Set up the Omni CLI configuration — API key, base URL, default instance, and providers.

## Usage

$ARGUMENTS

## Examples

```bash
omni auth login --api-key sk_xxx --api-url http://localhost:8882
omni config set defaultInstance my-whatsapp
omni config list
omni status
```
