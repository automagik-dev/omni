# Changelog

## Unreleased

### Omni Claude Code plugin (RFC-0005)

The plugin now routes requests directly to peer skills. The 11 duplicated slash
commands have been removed; use these router phrases instead:

| Removed command | Router phrase |
| --- | --- |
| `/omni:automate` | “Build an automation for incoming messages.” |
| `/omni:batch` | “Estimate a batch transcription of historical media.” |
| `/omni:chats` | “List my chats and show the conversation history.” |
| `/omni:config` | “Inspect my Omni configuration.” |
| `/omni:events` | “Show recent events for this instance.” |
| `/omni:instances` | “List my channel instances.” |
| `/omni:monitor` | “Monitor the connection health of this instance.” |
| `/omni:search` | “Search messages in this conversation.” |
| `/omni:send` | “Send a message to this recipient.” |
| `/omni:trace` | “Trace this message's journey.” |
| `/omni:tts` | “Send a voice message to this recipient.” |

See the [plugin README](plugins/omni/README.md) for peer mappings and validation
commands. CI now enforces skill size, frontmatter and peer section order, and
smokes the source-built CLI and named command examples. Install the CLI
separately; the retired SessionStart auto-installer remains removed.
