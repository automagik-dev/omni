# Council Review: Migrate Channel Error Classes to Core ChannelError

**Date:** 2026-03-11
**Issue:** #81

## Members Invoked

- **Architect** (Linus Torvalds): Stability, backwards compat, inheritance hierarchy
- **Questioner** (Ryan Dahl): Challenge assumptions, foundational simplicity
- **Simplifier** (TJ Holowaychuk): Complexity reduction, delete over add
- **Ergonomist** (Sindre Sorhus): Developer experience, API usability
- **Sentinel** (Troy Hunt): Security, error information leakage
- **Operator** (Kelsey Hightower): Operational debugging, observability

## Perspectives

### Architect
**Vote:** MODIFY
- Use `ChannelError` directly with `channelType` discriminator — no per-channel subclasses. Subclassing adds hierarchy without benefit since API already duck-types by `.code`.
- All channel-specific error codes must live in core `ERROR_CODES` — single source of truth. API's `CHANNEL_ERROR_MAP` already hardcodes channel codes.
- Standardize on `recoverable` — retire `retryable`. Semantically richer, aligns with core error philosophy.
- Provide backward-compat deprecated aliases so existing `instanceof` checks don't break.

### Questioner
**Vote:** REJECT
- 30+ channel-specific error codes collapse into ~4 core HTTP responses. The per-channel codes are intermediate artifacts with no consumer value.
- The mapping functions (`mapDiscordError`, `mapBaileysError`) are busy work — they could be inline. The real fix is to delete the channel Error subclasses entirely and throw `ChannelError` directly with core codes.
- However: the migration direction is correct. The REJECT is about scope — do more deletion, less wrapping.

### Simplifier
**Vote:** MODIFY
- Three separate error classes (~400 lines combined) are near-identical: code, retryable, context, name. Delete all three, use `ChannelError` directly.
- Many channel error codes in local enums are dead code — never used outside error definitions.
- Minimum change: delete old classes, use ChannelError, extend ERROR_CODES for missing categories.

### Ergonomist
**Vote:** MODIFY
- Constructor mismatch creates migration friction: `ChannelError(code, msg, type, id, opts)` vs `DiscordError(code, msg, retryable, ctx)`. After migration, there should be ONE pattern.
- `retryable` vs `recoverable` naming breaks semantic clarity — standardize on one term.
- Duck-typing in API middleware bypasses type safety. Add `instanceof ChannelError` check for the type-safe path.
- Channel errors lack `toJSON()` — migration to `ChannelError extends OmniError` fixes this automatically.

### Sentinel
**Vote:** MODIFY
- Error context (`Record<string, unknown>`) may contain sensitive data — tokens, URLs, IPs. Untyped context is a secrets exposure risk.
- Discord errors store API `url` in context, revealing infrastructure. Remove URL/method from context; keep only error codes and status.
- Upstream error messages from Discord/Slack/WhatsApp APIs may leak internal info. Use `CHANNEL_ERROR_MAP` messages for API responses, not raw upstream messages.
- Note: these are pre-existing security concerns, not introduced by the migration. Address separately.

### Operator
**Vote:** MODIFY
- Error semantic mismatch (`recoverable` vs `retryable`) breaks on-call mental model. Standardize.
- Channel error codes are swallowed: Discord's `MISSING_PERMISSIONS` becomes generic `CHANNEL_SEND_FAILED`. Preserve channel error codes through the stack via context.
- Channel errors lack `toJSON()` — structured logging can't serialize them. Migration to `OmniError` hierarchy fixes this.
- Rate limit errors should preserve `timeToReset` in context for smart retry logic. (Out of scope for this wish.)

## Synthesis

**Consensus:** Strong MODIFY (5 MODIFY, 1 REJECT)
**Votes:** 0 APPROVE, 5 MODIFY, 1 REJECT

**Key Themes:**
1. **Use ChannelError directly** — no per-channel subclasses (unanimous)
2. **Standardize on `recoverable`** — retire `retryable` (unanimous)
3. **Channel codes in core ERROR_CODES** — single registry (Architect, Operator, Simplifier)
4. **Delete > wrap** — remove old classes, provide deprecated aliases only (Questioner, Simplifier)
5. **Strengthen type safety** — `instanceof ChannelError` in API middleware (Ergonomist)
6. **Security context audit** — separate concern, out of scope (Sentinel)

**Recommendation:** Proceed with migration. Use `ChannelError` directly (no subclasses), add channel codes to core, standardize on `recoverable`, provide deprecated re-exports for backward compat, and strengthen API middleware with `instanceof ChannelError`. Keep mapping functions but change return types. Address security context concerns in a separate wish.
