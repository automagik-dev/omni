# Wish: Omni DX Quick Fixes

| Field | Value |
|-------|-------|
| **Status** | APPROVED |
| **Slug** | `omni-dx-quick-fixes` |
| **Date** | 2026-03-31 |
| **Design** | [DESIGN.md](../../brainstorms/omni-dx-quick-fixes/DESIGN.md) |
| **Issues** | automagik-dev/omni#320, automagik-dev/omni#319 |

## Summary

Two trivial DX fixes: register the dead `channels.ts` CLI commands in `index.ts`, and normalize "Omni v2" to "Omni" across 8 package.json description fields. Combined effort under 10 minutes.

## Scope

### IN
- Register `createChannelsCommand()` in `packages/cli/src/index.ts`
- Replace `"Omni v2"` with `"Omni"` in all package.json descriptions

### OUT
- No new CLI commands or changes to channels.ts implementation
- No README or docs changes
- No group members feature (#308 — separate)

## Decisions

| Decision | Rationale |
|----------|-----------|
| Register channels.ts as-is | Commands are implemented and follow standard patterns — just never wired |
| Use "Omni" in descriptions | Product name, not npm scope; "@automagik/omni" stays as package name |

## Success Criteria

- [ ] `omni channels list` returns available channel types
- [ ] `omni channels status` shows channel overview
- [ ] `grep -r "Omni v2" packages/*/package.json` returns zero matches
- [ ] `bun run build` succeeds

## Execution Strategy

### Wave 1 (parallel)
| Group | Agent | Description |
|-------|-------|-------------|
| 1 | engineer | Register channels CLI + normalize naming |

## Execution Groups

### Group 1: Register channels CLI + normalize naming

**Goal:** Wire up dead channels commands and fix product name consistency.

**Deliverables:**
1. In `packages/cli/src/index.ts`: add `import { createChannelsCommand } from './commands/channels.js'` and `program.addCommand(createChannelsCommand())` following the existing pattern
2. In these 8 files, replace `"Omni v2"` with `"Omni"` in the `description` field:
   - `packages/channel-a2a/package.json`
   - `packages/channel-discord/package.json`
   - `packages/channel-internal/package.json`
   - `packages/channel-slack/package.json`
   - `packages/channel-telegram/package.json`
   - `packages/channel-whatsapp/package.json`
   - `packages/cli/package.json`
   - `packages/plugin-openclaw/package.json`

**Acceptance Criteria:**
- [ ] `createChannelsCommand` is imported and registered in index.ts
- [ ] All 8 package.json descriptions use "Omni" not "Omni v2"
- [ ] `bun run build` succeeds
- [ ] `omni channels --help` shows list/add/status subcommands

**Validation:**
```bash
cd /home/genie/workspace/repos/omni && bun run build 2>&1 | tail -5 && grep -rc "Omni v2" packages/*/package.json | grep -v ":0$"
```

**depends-on:** none

---

## Files to Create/Modify

```
packages/cli/src/index.ts                   # Register channels command
packages/channel-a2a/package.json           # "Omni v2" → "Omni"
packages/channel-discord/package.json       # "Omni v2" → "Omni"
packages/channel-internal/package.json      # "Omni v2" → "Omni"
packages/channel-slack/package.json         # "Omni v2" → "Omni"
packages/channel-telegram/package.json      # "Omni v2" → "Omni"
packages/channel-whatsapp/package.json      # "Omni v2" → "Omni"
packages/cli/package.json                   # "Omni v2" → "Omni"
packages/plugin-openclaw/package.json       # "Omni v2" → "Omni"
```
