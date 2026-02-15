# Wish: Baileys Resilience Layer

**Status:** READY  
**Slug:** baileys-resilience  
**Created:** 2026-02-13  
**Depends on:** channel-parity-telegram-whatsapp  
**Complexity:** L  

---

## Problem

The WhatsApp plugin depends directly on `@whiskeysockets/baileys`, an unofficial, community-maintained library that reverse-engineers the WhatsApp Web protocol. This creates existential risk:

1. **Breaking changes without warning.** Baileys is pre-1.0, has no stability guarantees, and WhatsApp protocol changes can break it overnight. When Baileys breaks, our WhatsApp channel goes down with no fallback.

2. **API surface scattered across the plugin.** Direct `sock.sendMessage()`, `sock.groupCreate()`, `sock.readMessages()`, etc. calls are spread across 15+ files. A Baileys API change requires a codebase-wide hunt-and-fix.

3. **No version pinning strategy.** We track a Baileys version but have no policy for when/how to upgrade, no changelog review process, and no automated compatibility testing.

4. **No abstraction layer.** The plugin talks to Baileys directly — there's no intermediate adapter that could absorb API changes, provide fallbacks, or enable swapping to an alternative WhatsApp library (e.g., whatsapp-web.js, or a future official API adapter).

5. **No monitoring for protocol breaks.** When Baileys breaks due to a WhatsApp server-side change, we find out when users report failures — there's no proactive health check or canary.

The audit revealed WhatsApp has significantly more features than Telegram (50+ methods in `plugin.ts`), which means the blast radius of a Baileys break is enormous.

## Audit Evidence

- **Direct Baileys usage:** `sock.sendMessage()`, `sock.groupCreate()`, `sock.readMessages()`, `sock.sendPresenceUpdate()`, `sock.profilePictureUrl()`, `sock.onWhatsApp()`, `sock.chatModify()`, `sock.groupMetadata()`, and 20+ more — called directly across plugin.ts, senders/, handlers/.
- **No abstraction layer:** All Baileys types imported directly (`WAMessage`, `WASocket`, `BaileysEventMap`, etc.).
- **Health check gap:** WhatsApp plugin has no `getHealthChecks()` override — uses base class only (Telegram has one).
- **Version:** Single `@whiskeysockets/baileys` dependency in `package.json`, no pinning policy.

## Scope

### IN

- [ ] Create `BaileysAdapter` abstraction layer wrapping all `sock.*` calls used by the plugin
- [ ] Consolidate all direct `sock.*` usage behind the adapter (single file to update on Baileys changes)
- [ ] Implement version pinning policy: lock to exact Baileys version, document upgrade procedure
- [ ] Add Baileys compatibility test suite: fixture-based tests that verify adapter behavior against known Baileys responses
- [ ] Implement WhatsApp health check: `getHealthChecks()` override that verifies socket state + test operation
- [ ] Add connection monitoring: track disconnect frequency, auth failures, message send failures as metrics
- [ ] Implement graceful degradation: if specific Baileys features break, disable them without crashing the whole plugin
- [ ] Document Baileys upgrade runbook: how to test a new version, what to check, rollback procedure
- [ ] Add canary health probe: periodic lightweight operation (e.g., fetch own profile) to detect protocol breaks proactively

### OUT

- Migrating away from Baileys entirely (this is insulation, not replacement)
- WhatsApp Cloud API integration (separate strategic decision)
- Multi-library support (adapter pattern enables this later, but not implementing alternatives now)
- Automated Baileys version bumping (manual with runbook for now)
- Performance optimization of Baileys calls

## Acceptance Criteria

- [ ] `BaileysAdapter` class exists with methods for every `sock.*` call used in the plugin
- [ ] Zero direct `sock.*` calls outside the adapter (all go through `BaileysAdapter`)
- [ ] Baileys version pinned to exact version in `package.json` (no `^` or `~`)
- [ ] Upgrade runbook exists in `docs/` with step-by-step procedure and rollback instructions
- [ ] Test fixtures cover: message send, message receive, group operations, media download, presence, receipts
- [ ] `getHealthChecks()` implemented for WhatsApp plugin — returns socket state + last successful operation timestamp
- [ ] Canary probe runs every 5 minutes and logs/emits health status
- [ ] If adapter method throws a Baileys-specific error, it's caught and wrapped in a standard `ChannelError` (no Baileys types leak to callers)
- [ ] Feature flags per adapter method: can disable broken features via config without code changes
- [ ] Plugin still passes all existing tests after adapter refactor (zero regression)

## Library Blockers

- **None for this wish.** This is specifically about insulating ourselves from Baileys' instability. All work is on our side.
- **Risk:** Baileys could break *during* this refactor. If that happens, fix the break first, then continue the adapter work with the fix as motivation.
