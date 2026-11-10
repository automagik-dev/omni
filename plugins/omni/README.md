# Omni Claude Code plugin

The `omni` router selects a peer skill from the requested outcome. Install the
Omni CLI separately and read `omni --help` for the commands your version supports.
The plugin does not install software or start services.

## Removed slash commands

RFC-0005 removes the 11 duplicated commands. Ask the router in plain language;
the same intents are handled by the peers below. CLI commands remain available.

| Removed command | Router phrase | Peer |
| --- | --- | --- |
| `/omni:automate` | “Build an automation for incoming messages.” | `omni-automations` |
| `/omni:batch` | “Estimate a batch transcription of historical media.” | `omni-batch` |
| `/omni:chats` | “List my chats and show the conversation history.” | `omni-agent` |
| `/omni:config` | “Inspect my Omni configuration.” | `omni-config` |
| `/omni:events` | “Show recent events for this instance.” | `omni-events` |
| `/omni:instances` | “List my channel instances.” | `omni-instances` |
| `/omni:monitor` | “Monitor the connection health of this instance.” | `omni-instances` |
| `/omni:search` | “Search messages in this conversation.” | `omni-agent` |
| `/omni:send` | “Send a message to this recipient.” | `omni-agent` |
| `/omni:trace` | “Trace this message's journey.” | `omni-events` |
| `/omni:tts` | “Send a voice message to this recipient.” | `omni-agent` |

Communication and administrative actions still require authorization for the
intended recipient, instance and scope.

## Plugin gates

Run `bun run skills:lint` for the 100-line budget, strict frontmatter and peer
section order (`When to Use → Flow → Rules`). The router is exempt from section
order. Only `name`, `description` and optional `allowed-tools` are accepted;
shell skills must declare `allowed-tools`.

Run `bun run plugin:smoke` to build the CLI from source, check its help, resolve
the manifest/router/peers and check named commands and flags with the existing
CLI drift checker. This is a local, server-free smoke; it does not start a
Claude Code session or claim live routing or channel delivery. Skills discover
the installed CLI with `--help`; reference examples are validated against the
registered CLI rather than maintained as a separate command inventory.

The plugin CI job runs both aliases on every PR (including `plugins/omni/**`)
and merge queue tree. `make skill-cli-check` also runs the lint and checker tests.
