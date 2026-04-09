# Design: Complete Omni CLI Documentation + Skills Update

| Field | Value |
|-------|-------|
| **Slug** | `omni-docs-cleanup` |
| **Date** | 2026-03-24 |
| **WRS** | 100/100 |

## Problem
The Omni CLI has 25 command groups with ~100 subcommands. Only 5 are documented. Even AI agents constantly mess up omni commands — wrong flags, wrong syntax, missing features they don't know exist. People (and agents) don't know what we're capable of. This wastes hours in debugging, duplicate issue filing, and reinventing existing features.

**The documentation gap:**
| Status | Commands |
|--------|----------|
| ✅ Documented (5) | send, chats, messages, instances, events |
| ❌ Missing (20) | routes, providers, access, keys, persons, media, automations, webhooks, settings, batch, prompts, resync, logs, dead-letters, payloads, journey, config, auth, status, completions |

Additionally:
- `AGENT_ROUTING.md` uses the OLD JSON format (`--reply-filter '{"mode":"whitelist"}'`) instead of current `omni routes` / `omni access` commands
- No multi-instance setup guide (workaround is undiscoverable)
- Agents file issues for features that already exist because skills don't document them

## Scope
### IN
- Complete ALL 20 missing command sections in `.claude/skills/omni-cli/reference/commands.md`
- Rewrite `.agents/skills/omni-orchestrator/references/AGENT_ROUTING.md` with current CLI commands
- Create `docs/guides/multi-instance.md` for multi-Omni deployment
- Close #252 and #240

### OUT
- Global genie plugin skills (separate repo)
- No code changes to the CLI itself
- No new features

## Execution Groups

### Group 1: CLI Reference — High-Impact Commands
Document the commands that agents and developers use most and mess up most:

**Routes** (7 subcommands) — multi-agent routing
```
omni routes list/get/create/update/delete/test/metrics
```
Key flags: --scope, --chat, --person, --agent, --stream/--no-stream, --gate, --reply-filter-mode, --label, --priority

**Providers** (10 subcommands) — AI provider management
```
omni providers setup/list/get/create/test/agents/teams/workflows/update/delete
```
Key flags: --schema (agno|webhook|openclaw|ag-ui|claude-code|a2a|genie), --base-url, --api-key, --project-path, --agent-name, --target-agent, --team-name template

**Access** (8 subcommands) — access control
```
omni access list/create/delete/mode/check/pending/approve/deny
```
Key flags: --type (allow|deny), --phone (wildcard patterns), --user, --action (block|silent_block|allow), --message

**Keys** (6 subcommands) — API key management
```
omni keys create/list/get/update/revoke/delete
```

**Files:**
- `.claude/skills/omni-cli/reference/commands.md` — add routes, providers, access, keys sections

### Group 2: CLI Reference — All Remaining Commands
Document every remaining command:

**Persons** (3 subcommands)
```
omni persons search/get/presence
```

**Media** (2 subcommands)
```
omni media list/download
```

**Automations** (10 subcommands)
```
omni automations list/get/create/update/delete/enable/disable/test/execute/logs
```

**Webhooks** (6 subcommands)
```
omni webhooks list/get/create/update/delete/trigger
```

**Settings** (3 subcommands)
```
omni settings list/get/set
```

**Batch** (5 subcommands)
```
omni batch list/create/status/cancel/estimate
```

**Prompts** (4 subcommands)
```
omni prompts list/get/set/reset
```

**Dead Letters** (6 subcommands)
```
omni dead-letters list/get/stats/retry/resolve/abandon
```

**Payloads** (4 subcommands)
```
omni payloads list/get/delete/config
```

**Journey** (2 subcommands)
```
omni journey show/summary
```

**Standalone commands:**
```
omni resync --instance <id> --since <duration>
omni logs [level] --modules <filter> --process --follow
omni config list/get/set/unset
omni auth login/status/logout/recover
omni status
omni completions [shell]
```

**Files:**
- `.claude/skills/omni-cli/reference/commands.md` — add ALL remaining sections

### Group 3: Agent Routing Skill + Multi-Instance Guide

**Rewrite AGENT_ROUTING.md:**
- Replace old JSON format (`--reply-filter '{"mode":"whitelist",...}'`) with current commands
- Use `omni routes create --scope user --person X --agent Y` syntax
- Use `omni access create --type allow --phone "+55*"` syntax
- Document route resolution order: chat route > user route > instance default
- Add multi-agent pattern example from #252:
```
Instance (1 WhatsApp number)
  ├── Route: Felipe → dev agent (debounce: off, ack: off)
  ├── Route: Antonio → test agent B
  └── Default → production agent (instance defaults)
```
- Document provider schemaConfig for genie schema: agentName, targetAgent, teamName template

**Create multi-instance guide** (`docs/guides/multi-instance.md`):
- PM2 ecosystem.config.js template
- Environment variables: HOME, PGSERVE_PORT, API_PORT
- NATS binary copy requirement
- CLI usage with --api-url and --api-key per instance
- Known limitations (multi-device routing unpredictability)
- Note: "This workaround may be unnecessary if you use route-level config overrides — see omni routes"

**Files:**
- `.agents/skills/omni-orchestrator/references/AGENT_ROUTING.md` — full rewrite
- `docs/guides/multi-instance.md` — new file

## Documentation Format per Command

Each command section should follow this pattern:
```markdown
## omni <command>

<One-line description>

### Subcommands

#### omni <command> <sub> [options]
<Description>

**Options:**
- `--flag <value>` — Description (default: X)

**Examples:**
\`\`\`bash
omni <command> <sub> --flag value   # Practical example with comment
\`\`\`
```

**CRITICAL: Include practical examples for every subcommand.** The `--help` output shows flags but not how to use them together. Examples are what agents and humans actually need.

## Decisions
| Decision | Rationale |
|----------|-----------|
| Document ALL 20 command groups, not just the "important" ones | Partial docs are worse than no docs — agents assume undocumented features don't exist |
| Practical examples for every subcommand | `--help` shows syntax, examples show intent. Agents copy examples, not flag descriptions. |
| Keep multi-instance guide even though route overrides will exist | They solve different problems. Multi-instance = full isolation. Routes = config overrides. Both valid. |
| Generate from --help + cross-reference source | --help is auto-generated from code and is the single source of truth |

## Risks & Assumptions
| Risk | Severity | Mitigation |
|------|----------|------------|
| 20 sections × ~40 lines = ~800 lines of docs | Medium | Structured template keeps it consistent. Engineers generate from --help output. |
| Docs may get stale as CLI evolves | Low | commands.md lives next to the code. PRs that add CLI commands should update docs. |
| Some commands have complex JSON flags | Low | Show the JSON inline in examples, not as a "see API docs" cop-out |

## Success Criteria
- [ ] `commands.md` has documented sections for ALL 25 command groups (5 existing + 20 new)
- [ ] Every subcommand has at least one practical example
- [ ] `AGENT_ROUTING.md` uses current `omni routes` / `omni access` CLI commands (zero old JSON format)
- [ ] `AGENT_ROUTING.md` includes multi-agent routing example with route resolution order
- [ ] `docs/guides/multi-instance.md` exists with PM2 template and env var reference
- [ ] Close GitHub issues #252 and #240
