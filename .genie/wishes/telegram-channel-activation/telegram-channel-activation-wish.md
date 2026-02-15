# WISH: Telegram Channel Activation + CLI Channel Management

> Make adding a Telegram bot as easy as `omni channels add telegram <token>`. One command, 30 seconds, done.

**Status:** APPROVED
**Beads:** omni-m17
**Created:** 2026-02-10
**Author:** WISH Agent + Felipe
**Reviewed by:** Council (7 members, 2 APPROVE / 5 MODIFY → revised)
**Inspiration:** OpenClaw — creating a Telegram bot takes 10 seconds (talk to BotFather, paste token, done)

---

## Problem Statement

PR #13 shipped the `channel-telegram` plugin (grammy-based, full BaseChannelPlugin). But it's not wired up end-to-end:
1. The `POST /instances` route passes `token` in transient `connectionOptions` but never persists it to the `telegram_bot_token` DB column
2. `autoReconnectInstances()` passes `credentials: {}` — so after API restart, Telegram bots can't reconnect (token lost)
3. The CLI has no `channels` command group — no easy way to see available channels or set up a new bot
4. No interactive setup wizard — you need to know the exact API payload format

**Root cause:** The instances API was built for WhatsApp (auth state stored in files), not token-based channels (Discord, Telegram, Slack) where the credential MUST be persisted to the DB.

## Vision

```bash
# The dream: one command, you're live
omni channels add telegram --token "123456:ABC-DEF..."
# → Validates token with Telegram API
# → Creates instance with token persisted in DB
# → Connects bot in long-polling mode
# → "✅ Connected as @GenieOmniBot (Genie Omni)"

# Or interactive
omni channels add telegram
# → Prompts: "Paste your BotFather token:"
# → "✅ Connected as @GenieOmniBot (Genie Omni)"
# → "Instance created: tg-genie-omni (abc123)"

# See what you've got
omni channels list
# → whatsapp-baileys: 5 instances (3 connected)
# → telegram: 1 instance (1 connected)
# → discord: 0 instances

# Quick status
omni channels status
```

## Assumptions

- **ASM-1**: ✅ VERIFIED — The `channel-telegram` plugin IS auto-discovered by `discoverAndRegisterPlugins()` in `packages/api/src/plugins/loader.ts` (scans `packages/channel-*`)
- **ASM-2**: Telegram bot tokens are obtained from @BotFather — user already has one
- **ASM-3**: ✅ VERIFIED — `ChannelTypeSchema` already includes `'telegram'`, DB schema has `telegram_bot_token` column
- **ASM-4**: ✅ VERIFIED — Grammy validates token via `bot.init()` → `getMe()` during connect
- **ASM-5**: ✅ VERIFIED — Long-polling works, webhook mode throws "not yet supported"

## Decisions

- **DEC-1**: Token stored in `instances.telegram_bot_token` DB column (already exists, just not wired up)
- **DEC-2**: `POST /instances` and `POST /instances/:id/connect` must persist token to DB AND pass it to `plugin.connect()` via credentials
- **DEC-3**: `autoReconnectInstances()` must read `telegram_bot_token` from the DB row and pass it to `plugin.connect()` as `credentials.token`
- **DEC-4**: Long-polling mode by default (simplest setup — no public URL needed). Webhook mode remains out of scope
- **DEC-5**: `omni channels` as new top-level CLI command group — high-level channel overview (list types, add with wizard, status). `omni instances` stays for low-level management
- **DEC-6**: Interactive prompts with fallback to flags (works for both humans and LLMs)
- **DEC-7**: Same pattern applies to Discord (`discordBotToken`) — fix generically for all token-based channels

## Risks

- **RISK-1**: Telegram rate limits on long-polling. **Mitigation**: Grammy handles this natively with backoff.
- **RISK-2**: Token stored in plaintext in DB. **Mitigation**: Same pattern as `discord_bot_token` and `slack_bot_token` columns — consistent with existing security model. Encryption at rest is a DB-level concern.
- **RISK-3**: Token exposed in API responses. **Mitigation**: Instance list/get responses already include all DB fields. We should redact token fields in API responses (mark as follow-up, not blocking for this wish).

---

## Scope

### IN SCOPE

1. **Fix token persistence** — `POST /instances` and `POST /instances/:id/connect` save token to `telegram_bot_token` column
2. **Fix reconnection** — `autoReconnectInstances()` reads stored token and passes to `plugin.connect()`
3. **CLI `channels` command group** — list, add, status
4. **CLI `channels add telegram`** — interactive + flag-based Telegram setup
5. **Token validation** — inline during create (via `bot.init()`, not a separate endpoint)
6. **Bot info display** — show bot username, name after setup

### OUT OF SCOPE

- Webhook mode setup (requires public URL, SSL — separate wish)
- Telegram-specific CLI commands (uses existing `omni send`)
- Discord/Slack channel setup wizards (same pattern, separate wish — but token persistence fix covers them)
- Token encryption at rest (DB-level concern)
- Redacting tokens from API responses (follow-up)
- Channel plugin hot-reload
- Multi-bot per instance

---

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| api | routes (instances), plugins (loader) | Token persistence + reconnection |
| cli | commands (new channels.ts) | New command group |
| core | — | No changes needed (schemas already correct) |
| db | — | No changes needed (column already exists) |
| channel-telegram | — | No changes needed (plugin already works) |
| sdk | regenerate | If API surface changed |

### System Checklist

- [ ] **Events**: No new event types needed
- [ ] **Database**: No schema changes — `telegram_bot_token` column already exists
- [ ] **SDK**: Regenerate if API create schema changes (adding `telegramBotToken` field)
- [x] **CLI**: New `channels` command group
- [ ] **Tests**: API token persistence, reconnection, CLI commands

---

## Execution Groups

### Group 1: API — Token Persistence & Reconnection

**Goal:** Fix the token lifecycle: persist on create → read on reconnect → pass to plugin

**Packages:** api

**Deliverables:**
- [ ] Modify `POST /instances` route: when `channel === 'telegram'` and `data.token` is provided, save it to `telegramBotToken` in the DB insert AND pass as `credentials.token` to `plugin.connect()`
- [ ] Modify `POST /instances/:id/connect` route: when body has `token` and instance is telegram, update `telegramBotToken` in DB AND pass as `credentials.token`
- [ ] Modify `autoReconnectInstances()` in `plugins/loader.ts`: read `instance.telegramBotToken` (and `discordBotToken`) from the DB row and pass as `credentials.token` to `plugin.connect()`
- [ ] Update `createInstanceSchema` to accept `telegramBotToken` field (optional, for Telegram instances)
- [ ] Ensure `GET /instances` and `GET /instances/:id` do NOT return token fields in responses (or redact them)

**Acceptance Criteria:**
- [ ] `curl POST /instances -d '{"name":"my-bot","channel":"telegram","token":"..."}` creates instance with token persisted in DB
- [ ] After API restart (`make restart-api`), Telegram instance auto-reconnects successfully
- [ ] Bot receives messages and emits `message.received` events
- [ ] `make typecheck && make lint` pass

**Validation:**
```bash
make typecheck && make lint
# Manual: create telegram instance, restart API, verify reconnection
```

### Group 2: CLI — Channel Management Commands

**Goal:** `omni channels list|add|status` — channel-aware CLI with interactive Telegram setup

**Packages:** cli

**Deliverables:**
- [ ] New `packages/cli/src/commands/channels.ts` with:
  - `omni channels list` — shows available channel types (from `/instances/supported-channels`) + instance count per type
  - `omni channels add <type>` — interactive wizard per channel type
  - `omni channels add telegram [--token <token>] [--name <name>]` — Telegram-specific flow:
    1. Prompt for token if not provided via `--token`
    2. Create instance via API (token persisted by Group 1 fix)
    3. Wait for connection confirmation
    4. Display bot info (username, name)
  - `omni channels status` — overview of all channels and their connection state (grouped by channel type)
- [ ] Error messages guide users: "Token invalid — get one from @BotFather: https://t.me/BotFather"
- [ ] Register new command in CLI's main command setup

**Acceptance Criteria:**
- [ ] `omni channels add telegram --token "..."` creates a working Telegram bot in one command
- [ ] `omni channels list` shows all channel types with instance counts
- [ ] `omni channels add telegram` (no flags) prompts interactively for token
- [ ] Human-readable output with bot info confirmation
- [ ] `make typecheck && make lint` pass

**Validation:**
```bash
make cli-build
omni channels list
omni channels add telegram --token "$TELEGRAM_BOT_TOKEN" --name "test-bot"
omni channels status
make typecheck && make lint
```

---

## Notes

- This wish establishes the `omni channels` pattern reusable for Discord, Slack, and future channels
- The token persistence fix (Group 1) also fixes Discord reconnection — `discordBotToken` has the same gap
- The CLI UX should feel like OpenClaw's bot setup — minimal friction, smart defaults
- Once this ships, adding a new channel to Omni should be a 30-second operation
- **Council review insight**: The original draft missed the critical credential persistence gap — this revised version makes it Group 1 priority
