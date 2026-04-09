# Wish: Channel Error Hardening — Security, Telegram, and Code Conventions

**Status:** DRAFT
**Slug:** channel-error-migration
**Date:** 2026-03-11
**Issue:** #81

---

## Summary

Three focused fixes for channel error handling: (1) sanitize error.context before it reaches HTTP responses (security), (2) add typed errors to Telegram which currently throws raw `Error`, and (3) standardize error code naming with channel prefixes (`DISCORD_*`, `WHATSAPP_*`, `SLACK_*`, `TELEGRAM_*`) across all channels.

## Scope

### IN
- **Security fix:** Sanitize `error.context` in API error middleware before it flows to HTTP responses (prevents leaking internal state)
- **Telegram error class:** Add `TelegramError` extending `ChannelError` (or use `ChannelError` directly with typed codes) so Telegram stops throwing raw `Error`
- **Error code naming:** Standardize channel-specific error codes with prefixed names (`DISCORD_*`, `WHATSAPP_*`, `SLACK_*`, `TELEGRAM_*`) in core `ERROR_CODES` so `CHANNEL_ERROR_MAP` is maintainable

### OUT
- Full migration of Discord/WhatsApp/Slack error classes to extend core `ChannelError`
- Removing local error classes (`DiscordError`, `WhatsAppError`, `SlackError`)
- Deprecated re-exports for backward compatibility
- Changing `retryable` → `recoverable` standardization across all channels
- Modifying `mapDiscordError()` or `mapBaileysError()` return types
- Adding `instanceof ChannelError` checks to API middleware
- Refactoring `CHANNEL_ERROR_MAP` structure

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Security fix scope | Sanitize context in API catch handler only | Minimal blast radius — don't change error classes, just strip sensitive fields at the boundary |
| Telegram error approach | Use `ChannelError` directly with `TELEGRAM_*` codes | No need for a separate `TelegramError` subclass — matches council consensus against per-channel subclasses |
| Error code location | Add prefixed codes to core `ERROR_CODES` | Single source of truth. API's `CHANNEL_ERROR_MAP` already references channel codes |
| Existing channel errors | Leave as-is | Discord/WhatsApp/Slack error classes work fine — full migration is deferred |

## Success Criteria

- [ ] API error middleware sanitizes `error.context` before including it in HTTP responses — no internal state leaks
- [ ] Telegram plugin throws `ChannelError` (not raw `Error`) for channel-specific failures (missing bot, send failures, auth issues)
- [ ] Core `ERROR_CODES` includes prefixed codes for all four channels: `DISCORD_*`, `WHATSAPP_*`, `SLACK_*`, `TELEGRAM_*`
- [ ] `CHANNEL_ERROR_MAP` in API middleware maps all new prefixed codes to appropriate HTTP statuses
- [ ] `make check` passes (lint + types + tests)
- [ ] No raw `Error` throws for channel-specific failures in Telegram plugin

## Assumptions & Risks

| Risk | Mitigation |
|------|-----------|
| Context sanitization too aggressive — strips useful debug info | Sanitize only for HTTP responses; keep full context in logs/Sentry |
| Telegram raw `Error` throws hard to classify | Only convert clearly channel-related throws (missing bot, send failures). Leave truly unexpected errors as-is |
| Adding codes to core creates coupling | Codes are string constants, not runtime behavior. Channels can extend the type for new codes |

---

## Execution Groups

### Group 1: Security Fix — Sanitize Error Context in API Responses

**Goal:** Prevent `error.context` from flowing unsanitized into HTTP responses. This is a security fix that is critical regardless of error unification.

**Key files:**
- `packages/api/src/middleware/error.ts` (or wherever the catch handler lives)

**Deliverables:**
- [ ] Identify where `error.context` gets included in HTTP response bodies
- [ ] Add a `sanitizeErrorContext()` function that strips or redacts sensitive fields (instanceId internals, credentials, tokens, stack traces, raw config)
- [ ] Apply sanitization in the API error catch handler before building the response
- [ ] Ensure full unsanitized context is still available in server-side logs and Sentry

**Acceptance:**
- HTTP error responses contain only safe, user-facing error information
- Server logs retain full error context for debugging
- No regression in error handling behavior
- `bun run --filter @omni/api typecheck` passes

**Validation:**
```bash
cd packages/api && bun run typecheck && bun test
```

---

### Group 2: Add Channel-Prefixed Error Codes to Core

**Goal:** Add standardized, prefixed error codes for all four channels to core `ERROR_CODES` so error handling is consistent and `CHANNEL_ERROR_MAP` is maintainable.

**Key files:**
- `packages/core/src/errors.ts` (or wherever `ERROR_CODES` is defined)

**Deliverables:**
- [ ] Add Discord error codes: `DISCORD_NOT_CONNECTED`, `DISCORD_SEND_FAILED`, `DISCORD_AUTH_FAILED`, `DISCORD_RATE_LIMITED`, `DISCORD_NOT_FOUND`, `DISCORD_MISSING_ACCESS`, `DISCORD_MISSING_PERMISSIONS`, `DISCORD_UNKNOWN_ERROR`
- [ ] Add WhatsApp error codes: `WHATSAPP_NOT_CONNECTED`, `WHATSAPP_SEND_FAILED`, `WHATSAPP_AUTH_FAILED`, `WHATSAPP_RATE_LIMITED`, `WHATSAPP_INVALID_JID`, `WHATSAPP_PAIRING_FAILED`, `WHATSAPP_UNKNOWN_ERROR`
- [ ] Add Slack error codes: `SLACK_NOT_CONNECTED`, `SLACK_SEND_FAILED`, `SLACK_INVALID_TOKEN`, `SLACK_RATE_LIMITED`, `SLACK_FILE_UPLOAD_FAILED`, `SLACK_CONNECTION_FAILED`, `SLACK_UNKNOWN_ERROR`
- [ ] Add Telegram error codes: `TELEGRAM_NOT_CONNECTED`, `TELEGRAM_SEND_FAILED`, `TELEGRAM_AUTH_FAILED`, `TELEGRAM_RATE_LIMITED`, `TELEGRAM_BOT_MISSING`, `TELEGRAM_UNKNOWN_ERROR`
- [ ] Verify `ErrorCode` type automatically includes new codes
- [ ] Add new codes to `CHANNEL_ERROR_MAP` with appropriate HTTP status mappings

**Acceptance:**
- All channel-prefixed codes exist in `ERROR_CODES`
- `ErrorCode` type includes them
- `CHANNEL_ERROR_MAP` maps all new codes to HTTP statuses
- `bun run --filter @omni/core typecheck` passes

**Validation:**
```bash
cd packages/core && bun run typecheck
cd packages/api && bun run typecheck
```

---

### Group 3: Add Typed Errors to Telegram Plugin

**Goal:** Convert raw `throw new Error(...)` in Telegram plugin to `throw new ChannelError(...)` with proper codes so Telegram errors are classifiable.

**Depends on:** Group 2

**Key files:**
- `packages/channel-telegram/src/plugin.ts`
- `packages/channel-telegram/src/senders/media.ts`
- `packages/channel-telegram/src/index.ts`

**Deliverables:**
- [ ] Import `ChannelError` and `ERROR_CODES` from `@omni/core` in Telegram plugin
- [ ] Convert channel-specific error throws:
  - `throw new Error('Telegram bot token is required...')` → `new ChannelError(ERROR_CODES.TELEGRAM_AUTH_FAILED, ...)`
  - `throw new Error('Bot info missing after init...')` → `new ChannelError(ERROR_CODES.TELEGRAM_NOT_CONNECTED, ...)`
  - `throw new Error('No bot for instance...')` (multiple sites) → `new ChannelError(ERROR_CODES.TELEGRAM_BOT_MISSING, ...)`
  - Media send failures → `new ChannelError(ERROR_CODES.TELEGRAM_SEND_FAILED, ...)`
- [ ] Keep raw `Error` throws for truly unexpected/internal failures (not channel-specific)
- [ ] Set `recoverable` appropriately per error type
- [ ] Include `channelType: 'telegram'` and `instanceId` where available

**Acceptance:**
- Telegram plugin throws `ChannelError` for channel-specific failures
- `ChannelError` instances include `channelType: 'telegram'` and `instanceId` where available
- Unexpected/internal errors remain as raw `Error` throws
- `bun run --filter @omni/channel-telegram typecheck` passes

**Validation:**
```bash
cd packages/channel-telegram && bun run typecheck && bun test
```

---

### Group 4: Final Validation

**Goal:** Run full project checks to verify nothing is broken.

**Depends on:** Groups 1-3

**Deliverables:**
- [ ] `make check` passes (lint + types + tests across all packages)
- [ ] Verify no raw `Error` throws for channel-specific failures in Telegram
- [ ] Verify API error responses don't leak internal context

**Acceptance:**
- Zero lint errors
- Zero type errors
- All tests pass

**Validation:**
```bash
make check
```

---

## Dependencies

```
Group 1 (security fix) ← independent, start first
Group 2 (error codes) ← independent, can parallel with Group 1
Group 3 (Telegram errors) ← depends on Group 2
Group 4 (final validation) ← depends on Groups 1-3
```

**Execution order:**
- **Wave 1 (parallel):** Group 1 (security fix) + Group 2 (error codes)
- **Wave 2:** Group 3 (Telegram typed errors)
- **Wave 3:** Group 4 (final validation)
