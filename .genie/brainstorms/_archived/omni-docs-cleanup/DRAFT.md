# Omni Docs Cleanup: Routes + Multi-Instance + Skills

## Problem Statement

Three documentation gaps that cause real friction:

### Gap 1: Agent skills don't document omni routes (#252)
Agents file feature requests for things already implemented (multi-agent routing, per-chat providers, session isolation). The `/omni` skill and sub-skills don't cover:
- `omni routes create/list/test` — per-chat and per-user agent routing
- Provider `schemaConfig` for genie schema: teamName, sessionName, targetAgent
- Route resolution order: chat route > user route > instance default
- Multi-agent pattern on single WhatsApp number

### Gap 2: No guide for multi-instance setup (#240)
Teams running dev/staging/prod need multiple Omni installations. The workaround exists (HOME env override + PM2) but is undiscoverable. Key findings:
- `HOME` override redirects all Omni config
- `PGSERVE_PORT` env var prevents port conflicts
- `API_PORT` env var overrides config.json
- NATS binary must be copied per HOME dir
- Interpreter must be `/bin/bash` (omni-server is a bash wrapper)

### Gap 3: Skill coverage gaps
Looking at the existing skills (`/omni`, `/omni:routes`, `/omni:instances`, etc.), some are thin on practical examples. Need an audit pass.

## Proposed Solution

### Group 1: Update omni-cli and omni-routes skills
- Add routing examples to the omni-cli skill reference
- Document the genie provider schemaConfig fields
- Add multi-agent pattern example (the one from #252)
- Include `omni routes test` workflow

### Group 2: Create multi-instance guide
- `docs/guides/multi-instance.md` — formalize the HOME override pattern
- Include PM2 ecosystem.config.js example
- Document env vars: HOME, PGSERVE_PORT, API_PORT
- CLI usage with `--api-url` and `--api-key` per instance
- Known limitations (multi-device routing unpredictability)

### Group 3: Skills audit pass
- Check each `/omni:*` skill for completeness
- Add missing practical examples
- Ensure new features (routes, access rules, batch jobs) are documented

## Key Files
- Omni skills are in the genie repo, not omni repo — need to identify location
- `docs/guides/` — new multi-instance.md
- `docs/cli/` — CLI reference updates
- `.claude-plugin/marketplace.json` — skill metadata

## Questions for Brainstorm
1. Are omni skills in this repo or the genie repo? If genie, this wish is docs-only in omni.
2. Should the multi-instance guide live in `docs/guides/` or as a GitHub wiki page?
3. Should we also update the main README.md with a "Multi-Agent" section?
4. Is the skills audit too broad? Should we just focus on routes + multi-instance?

## GitHub Issues
- https://github.com/automagik-dev/omni/issues/252
- https://github.com/automagik-dev/omni/issues/240
