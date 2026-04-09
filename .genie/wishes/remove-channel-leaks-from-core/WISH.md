# Wish: Remove Dead Channel Columns from Instances Table

**Status:** DRAFT
**Slug:** remove-channel-leaks-from-core
**Date:** 2026-03-11
**Issue:** #88

---

## Summary

The `instances` table has 8 dead channel-specific columns (Discord and Slack config) that are defined in the schema but have zero runtime references in application code. This wish drops those columns and cleans up related Zod schemas. No JSONB migration, no data migration, no dual-read — just dead code removal.

## Scope

### IN
- Drop 8 unused columns from instances table: `discordClientId`, `discordGuildIds`, `discordDefaultChannelId`, `discordVoiceEnabled`, `discordSlashCommandsEnabled`, `discordWebhookUrl`, `discordPermissions`, `slackTeamId`
- Remove dead columns from Zod schemas in `packages/core/src/schemas/instance.ts`
- Remove dead columns from DB schema in `packages/db/src/schema.ts`
- Update `docs/api/v1-compatibility-layer.md` if it references these columns
- Generate Drizzle migration to drop the 8 columns

### OUT
- `channelConfig` JSONB column (deferred — council rejected as disproportionate cost for <50 deployments, ~3 schema touches/year)
- Data migration of non-sensitive config to JSONB (deferred)
- Dual-read support / fallback code (deferred)
- Dropping non-dead columns like `readReceipts`, `sessionPath`, `discordPresence`, `guildConfigOverrides`, `telegramReactionLevel` (deferred — these have active runtime references)
- Per-plugin `ChannelConfigSchema` Zod exports (deferred)
- Bot token columns (kept as typed columns for sanitization safety)
- Encryption at rest for tokens (separate concern)
- Baileys logger adapter removal (separate issue #90)
- New channel plugin creation or plugin generator tooling

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Phase 1 only: drop dead columns | Council verdict: 1 APPROVE, 6 REJECT, 3 MODIFY on full JSONB migration. No measured problem (3 schema touches/year for 4 channels). DX regression (instance.readReceipts → getChannelConfig helper). Disproportionate cost for <50 deployments. Operational risk with auto-migrate-on-startup |
| Which columns | 8 confirmed-dead columns | Zero runtime references outside schema.ts — verified with comprehensive grep |
| JSONB migration | Deferred indefinitely | Council consensus: solve a real problem when it exists, not a hypothetical one |

## Success Criteria

- [ ] 8 dead columns removed from `packages/db/src/schema.ts`
- [ ] 8 dead columns removed from `packages/core/src/schemas/instance.ts`
- [ ] Drizzle migration generated that drops only the 8 intended columns
- [ ] No broken references to dropped columns anywhere in codebase
- [ ] `make check` passes
- [ ] API starts successfully

## Assumptions & Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| 8 "dead" columns are actually used somewhere we missed | LOW | Pre-verified with comprehensive grep — zero runtime references found. `make check` validates no compile-time references |
| Migration fails on startup (auto-migrate) | LOW | Column drops are safe DDL — no data dependency, no constraint conflicts. Reversible by adding columns back |

---

## Execution Groups

### Group 1: Drop Dead Columns + Clean Schemas

**Goal:** Remove 8 columns that are defined in the schema but never referenced in application code.

**Deliverables:**
- [ ] Remove from `packages/db/src/schema.ts` instances table: `discordClientId`, `discordGuildIds`, `discordDefaultChannelId`, `discordVoiceEnabled`, `discordSlashCommandsEnabled`, `discordWebhookUrl`, `discordPermissions`, `slackTeamId`
- [ ] Remove from `packages/core/src/schemas/instance.ts` Zod schemas
- [ ] Update `docs/api/v1-compatibility-layer.md` if it references these columns
- [ ] Generate Drizzle migration: `cd packages/db && bunx drizzle-kit generate`
- [ ] Verify migration SQL drops only the 8 intended columns

**Acceptance:**
- `grep -r "discordClientId\|discordGuildIds\|discordDefaultChannelId\|discordVoiceEnabled\|discordSlashCommandsEnabled\|discordWebhookUrl\|discordPermissions\|slackTeamId" packages/db/src/schema.ts` returns empty
- `make check` green

**Validation:**
```bash
# Verify columns removed from schema
grep -E "discordClientId|discordGuildIds|discordDefaultChannelId|discordVoiceEnabled|discordSlashCommandsEnabled|discordWebhookUrl|discordPermissions|slackTeamId" packages/db/src/schema.ts && echo "FAIL" || echo "PASS: dead columns removed"

# Verify columns removed from Zod schemas
grep -E "discordClientId|discordGuildIds|discordDefaultChannelId|discordVoiceEnabled|discordSlashCommandsEnabled|discordWebhookUrl|discordPermissions|slackTeamId" packages/core/src/schemas/instance.ts && echo "FAIL" || echo "PASS: dead columns removed from Zod"

# Verify migration generated
ls packages/db/drizzle/*.sql | tail -1

# Full check
make check
```

### Group 2: Validate

**Goal:** Confirm no broken references and the API starts cleanly.

**Deliverables:**
- [ ] Run `make check` — must pass
- [ ] Verify no remaining references to dropped columns in `packages/` (excluding migration files)
- [ ] Verify API starts without errors

**Validation:**
```bash
# No stale references (excluding migration SQL files)
grep -rn "discordClientId\|discordGuildIds\|discordDefaultChannelId\|discordVoiceEnabled\|discordSlashCommandsEnabled\|discordWebhookUrl\|discordPermissions\|slackTeamId" packages/ --include="*.ts" && echo "FAIL: stale references" || echo "PASS: clean"

# Full check
make check
```

---

## Dependencies

```
Group 1 ← independent (can start immediately)
Group 2 ← depends on Group 1

No external dependencies.
```
