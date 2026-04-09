# Fix Omni Mini-Bugs #245, #246, #247

## Summary
Three surgical bug fixes discovered during WhatsApp integration testing on 2026-03-23. All are low complexity with clear root causes already identified.

## Scope

### IN
- #245: Better error messaging when vision API keys are missing
- #246: Fix `omni chats messages --json` producing invalid/truncated JSON
- #247: Normalize JIDs in access rule matching (`ruleMatches()`)

### OUT
- No architectural changes
- No new features
- No schema migrations

## GitHub Issues
- https://github.com/automagik-dev/omni/issues/245
- https://github.com/automagik-dev/omni/issues/246
- https://github.com/automagik-dev/omni/issues/247

## Execution Groups

### Group 1: fix-access-jid-normalization
**Issue:** #247
**Priority:** HIGH — blocks allowlist functionality entirely
**Files:**
- `packages/api/src/services/access.ts` (line 663, `ruleMatches()`)
- `packages/api/src/services/__tests__/access.test.ts`

**Task:**
In `ruleMatches()`, normalize both `rule.platformUserId` and `platformUserId` by stripping `@.*` suffix before comparing:

```typescript
private ruleMatches(rule: AccessRule, platformUserId: string): boolean {
    if (rule.platformUserId) {
        const normalizeJid = (id: string) => id.replace(/@.*$/, '');
        if (normalizeJid(rule.platformUserId) === normalizeJid(platformUserId)) {
            return true;
        }
    }
    // phone pattern match unchanged
    if (rule.phonePattern) { ... }
    return false;
}
```

**Tests:** Add test cases:
- Rule `54958418317348@lid` matches bare `54958418317348`
- Rule `120363421396472428@g.us` matches bare `120363421396472428`
- Rule `5512982298888@s.whatsapp.net` matches bare `5512982298888`
- Bare rule `54958418317348` still matches bare `54958418317348`

**Validate:**
```bash
cd packages/api && bun test src/services/__tests__/access.test.ts
```

### Group 2: fix-cli-json-output
**Issue:** #246
**Priority:** MEDIUM — workaround exists (use non-JSON format)
**Files:**
- `packages/cli/src/commands/chats.ts` (messages subcommand, JSON output path)

**Task:**
Investigate and fix the truncated JSON output from `omni chats messages <id> --json`. Likely causes:
1. stdout buffer not flushing before process exit
2. String encoding issue with Portuguese/Unicode characters
3. Response body truncation in the HTTP client

**Validate:**
```bash
omni chats messages 274c8254 --json 2>/dev/null | python3 -c "import json,sys; data=json.load(sys.stdin); print(f'OK: {len(data)} messages')"
```

### Group 3: improve-media-key-errors
**Issue:** #245
**Priority:** LOW — already fixed manually, this improves DX
**Files:**
- `packages/media-processing/src/service.ts` (`createMediaProcessingService()`)
- `packages/media-processing/src/processors/image.ts` (`ImageProcessor`)

**Task:**
Add startup validation: when `MediaProcessingService` is created, check for required API keys and log a clear warning:
```
[WARN] media-processing: No vision API configured — set GEMINI_API_KEY or OPENAI_API_KEY in .env for image/video/document processing
```

Don't throw — just warn. The service should still start but clearly communicate what's missing.

**Validate:**
```bash
# Temporarily unset keys and check logs
GEMINI_API_KEY= OPENAI_API_KEY= bun run packages/media-processing/src/service.ts 2>&1 | grep -i "vision\|api.*key"
```

## Acceptance Criteria
- [ ] All 3 fixes have passing unit tests
- [ ] `bun test` passes across affected packages
- [ ] No regressions in existing test suite
- [ ] PR targets `dev` branch
