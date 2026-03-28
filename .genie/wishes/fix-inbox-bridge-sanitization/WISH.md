# fix-inbox-bridge-sanitization

> Extend `sanitizeOutboundText()` to the inbox-bridge relay path — defense-in-depth.

## GitHub Issue
- **#312** — fix: add outbound sanitization to inbox-bridge relay path

## Problem
PR #311 added `sanitizeOutboundText()` to two outbound chokepoints (agent-dispatcher and v2/messages), but the inbox-bridge (`inbox-bridge.ts:353`) passes `parsed.cleanText` directly to `plugin.sendMessage()` without sanitization. If an agent echoes back routing headers or `⚡ REPLY NOW` directives, they leak to external channels through this path.

## Scope
- **In:** Add sanitization call in inbox-bridge before sendMessage
- **Out:** No new sanitization patterns, no API changes, no schema changes

## Acceptance Criteria
1. `parsed.cleanText` is passed through `sanitizeOutboundText()` before constructing the `OutgoingMessage` in `inbox-bridge.ts`
2. If sanitized text is empty (message was entirely metadata), the message is silently skipped
3. Existing inbox-bridge tests (if any) still pass
4. `sanitizeOutboundText` is imported from `@omni/channel-sdk`

## Key Files
| File | Change |
|------|--------|
| `packages/api/src/plugins/inbox-bridge.ts:349-357` | Import `sanitizeOutboundText`, apply to `parsed.cleanText`, skip if empty |

## Execution Groups

### Group 1: Apply sanitizer (single file change)

| # | Deliverable | File |
|---|-------------|------|
| 1 | Import `sanitizeOutboundText` from `@omni/channel-sdk` | `packages/api/src/plugins/inbox-bridge.ts` |
| 2 | Sanitize `parsed.cleanText` before constructing `OutgoingMessage` | `packages/api/src/plugins/inbox-bridge.ts:349-353` |
| 3 | Skip send if sanitized text is empty (return `'ok'`) | `packages/api/src/plugins/inbox-bridge.ts` |

## Validation
```bash
bun test                    # Full suite passes
bun run build               # Zero errors
bunx biome check .          # Zero lint errors
```

## Confidence: 100%
One-line fix with known pattern from PR #311.
