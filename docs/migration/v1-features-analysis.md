---
title: "V1 Features Analysis"
created: 2025-01-29
updated: 2026-02-09
tags: [migration, features, analysis]
status: current
---

# V1 Features Analysis

> A comprehensive analysis of v1 features: what's being carried forward, what's being changed, and what's being intentionally left behind.

> Related: [[plan|Migration Plan]], [[ui-reuse|UI Reuse Strategy]]

## Features Being Carried Forward (Enhanced)

These v1 features are being carried forward and enhanced in v2:

| V1 Feature | V2 Implementation | Enhancement |
|------------|-------------------|-------------|
| Message tracing | `omni_events` table | Full event sourcing, not just traces |
| User management | Identity Graph (Person + PlatformIdentity) | True cross-channel omnipresence |
| Access control (allow/deny) | `AccessControlService` | Pattern matching, rate limits, scheduling |
| Media transcription | Media Pipeline | Same providers, cleaner architecture |
| Instance management | Instance CRUD + Events | Event-driven status, better QR flow |
| Global settings | Settings API | Same functionality, cleaner API |
| Batch reprocessing | Batch Jobs API | Same functionality |
| Agent routing | `MessageRouter` | Same patterns, TypeScript native |
| Message debouncing | Instance config | Same modes (disabled/fixed/randomized) |
| Real-time logs | WebSocket `/api/v2/ws/logs` | Same functionality |
| Service management | Service API | Same start/stop/restart |

## Features Being Simplified

These v1 features are being simplified or streamlined:

### Database Configuration API

**V1:** Full `/database/test` and `/database/config` endpoints for dynamic database configuration.

**V2:** Database URL is set via environment variable only. No runtime database switching.

**Rationale:** Dynamic database configuration is a security risk and adds complexity. v2 targets a cleaner deployment model where config is set at deploy time, not runtime.

---

### Network Mode (LAN vs Cloud)

**V1:** Explicit "network mode" setting that affected public URL handling and webhook registration.

**V2:** Simplified to just `PUBLIC_URL` environment variable.

**Rationale:** The LAN/cloud distinction created confusion. Just set the public URL directly - the system handles the rest.

---

### User Preferences Sync (localStorage ↔ DB)

**V1:** `UserPreference` model that synced browser localStorage with database for persistence across devices.

**V2:** Not carrying forward. Use standard browser settings or implement in UI layer if needed.

**Rationale:** This is UI-layer concern, not backend. The v2 API doesn't need to manage browser preferences.

---

### Recovery API

**V1:** `/recovery/api-key` endpoint to recover lost API key via localhost.

**V2:** Simplified - API keys can be regenerated via CLI if you have database access.

**Rationale:** If you have localhost access, you can just run a CLI command. No need for a separate endpoint.

```bash
# v2 approach
bun run cli settings api-key --regenerate
```

## Features Being Changed Architecturally

### WhatsApp Connection

**V1:** Evolution API (Baileys fork) running as separate service with its own database tables.

**V2:** Baileys directly integrated as channel plugin. No separate service.

**Benefits:**
- Single codebase (no Python/TypeScript split)
- No Evolution API sync issues
- Direct control over Baileys behavior
- No Prisma schema conflicts

---

### Discord Bot Management

**V1:** `BotManager` class managing multiple Discord bot instances.

**V2:** Same concept but as `DiscordPlugin` with standardized interface.

**Key Preserved Features:**
- Multi-server support via `guildIds` config
- Slash commands (configurable per instance)
- Voice infrastructure (basic tracking)
- Message chunking for 2000-char limit

---

### Message Import

**V1:** `/messages/import` and `/messages/import/discord` for importing historical messages.

**V2:** Handled via sync API. Import is just a special case of sync.

```yaml
POST /api/v2/instances/:id/sync
Body:
  syncChats: true
  since: "2020-01-01"  # Import from this date
```

---

### Telemetry

**V1:** `telemetry.py` with opt-in anonymous usage tracking.

**V2:** Not included in initial release. May add later with explicit opt-in.

**Rationale:** Focus on core functionality first. Telemetry can be added post-launch if needed.

## Features Being Left Behind (Intentionally)

These v1 features are being intentionally dropped:

### Evolution API Dependency

**V1:** Full Evolution API integration with its own auth tables, Prisma schema, etc.

**V2:** Ditched entirely. Using Baileys directly.

**Why:** Evolution caused endless issues:
- Prisma `db push` deleting our columns
- Separate Python/TypeScript codebases
- Complex auth state management
- Difficult to debug

---

### Mixed Python/TypeScript Codebase

**V1:** Python backend + TypeScript UI + Evolution API (TypeScript).

**V2:** TypeScript only.

**Why:** Unified language = unified tooling, unified types, unified deployment.

---

### SQLAlchemy + Prisma Dual ORM

**V1:** SQLAlchemy for our models, Prisma for Evolution's models.

**V2:** Drizzle ORM only.

**Why:** Single ORM means no schema conflicts, simpler migrations, better type safety.

---

### Chat ID Resolver Service

**V1:** `ChatIdResolver` service to handle JID format complexity dynamically.

**V2:** JID resolution is built into the WhatsApp plugin directly.

**Why:** Simpler architecture - JID handling is channel-specific, should be in the plugin.

## Migration Notes

### Data Migration

V1 data CAN be migrated to v2. See [Migration Plan](./plan.md) for scripts.

Key mappings:
- `users` → `persons` + `platform_identities`
- `message_traces` → `omni_events`
- `instance_configs` → same table, updated schema
- `access_rules` → same table
- `global_settings` → same table

### Auth State Migration

WhatsApp auth state from Evolution can be migrated to Baileys format. See migration scripts.

### No Migration Needed

These v1 features don't require migration:
- User preferences (dropped)
- Telemetry data (dropped)
- Recovery tokens (not needed)
- Database config (env-based now)

## Decision Log

| Feature | Decision | Date | Rationale |
|---------|----------|------|-----------|
| Evolution API | Remove | 2025-01 | Caused Prisma conflicts, maintenance burden |
| User preferences sync | Remove | 2025-01 | UI concern, not backend |
| Database config API | Remove | 2025-01 | Security risk, over-engineered |
| Network mode | Simplify | 2025-01 | Just use PUBLIC_URL |
| Telemetry | Defer | 2025-01 | Not essential for launch |
| Mixed language | Remove | 2025-01 | TypeScript-only stack |

## Gap Analysis (Updated)

All v1 features have been analyzed and either:
- Carried forward (same or enhanced)
- Simplified (cleaner approach)
- Intentionally dropped (with rationale)

### Features Added After Initial Analysis

| Feature | V2 Endpoint | Notes |
|---------|-------------|-------|
| Validate recipient | `POST /api/v2/instances/:id/validate-recipient` | Check if phone/ID is valid |
| Mark chat as read | `PATCH /api/v2/instances/:id/chats/:chatId/mark-read` | Same as v1 |
| Mark message as read | `PATCH /api/v2/instances/:id/messages/:messageId/mark-read` | Same as v1 |
| Instance discovery | `POST /api/v2/instances/discover` | Find existing Baileys sessions |
| Send sticker | `POST /api/v2/messages/sticker` | Same as v1 |
| Send contact | `POST /api/v2/messages/contact` | Same as v1 |
| Send location | `POST /api/v2/messages/location` | Same as v1 |

## Questions?

If you're unsure whether a v1 feature is supported in v2, check:

1. This document first
2. The [API Endpoints](../api/endpoints.md) reference
3. The [Architecture Overview](../architecture/overview.md)

Or ask in the issue tracker.
