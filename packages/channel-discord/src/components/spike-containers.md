# Spike: Discord Components v2 Support in discord.js

**Date:** 2026-02-17
**Author:** Omni v2 Agent
**Status:** COMPLETED

## Summary

Discord Components v2 (containers, sections, separators, media galleries, files, text displays)
was announced in February 2025 and is available via the Discord API with the `IS_COMPONENTS_V2`
message flag (1 << 15 = 32768).

## discord.js v14.x Support Status

**Version checked:** discord.js ^14.18.0 (installed in this project)

### Findings

1. **discord.js v14.x does NOT have native builders** for Components v2 types (Container,
   Section, Separator, MediaGallery, File, TextDisplay). These are new component types
   (types 17, 12, 14, 13, 11, 10) not yet available in the v14 builder API.

2. **discord.js v15 is not yet stable.** As of February 2026, v15 is in development but
   not released to npm stable channel.

3. **Raw API approach is viable.** Discord.js exposes `client.rest.post()` and allows
   sending raw component JSON via the REST API. Messages with `flags: 32768` enable
   Components v2 rendering.

### Chosen Approach: Raw JSON Builders

Since discord.js v14 doesn't have native Components v2 builders, we implement our own
builder functions that produce raw Discord API-compatible JSON. These builders:

- Return plain objects matching the Discord Components v2 API schema
- Are sent via `channel.send()` with raw component arrays and the `IS_COMPONENTS_V2` flag
- Are gated behind a `discordComponentsV2` feature flag (default: off)

### Component Type IDs (Discord API)

| Component | Type ID | Status |
|-----------|---------|--------|
| ActionRow | 1 | Existing (v1) |
| Button | 2 | Existing (v1) |
| StringSelect | 3 | Existing (v1) |
| TextInput | 4 | Existing (v1) |
| UserSelect | 5 | Existing (v1) |
| RoleSelect | 6 | Existing (v1) |
| MentionableSelect | 7 | Existing (v1) |
| ChannelSelect | 8 | Existing (v1) |
| TextDisplay | 10 | **New (v2)** |
| File | 11 | **New (v2)** |
| Section | 12 | **New (v2)** |
| MediaGallery | 13 | **New (v2)** |
| Separator | 14 | **New (v2)** |
| Container | 17 | **New (v2)** |

### Risk Assessment

- Components v2 is still in beta at Discord — API may change
- Feature flag provides safe rollback mechanism
- Raw JSON approach decouples from discord.js version
- No native builder validation — we implement our own

### Decision

Implement raw JSON builders with feature flag gating. When discord.js v15 adds
native builders, we can optionally migrate. The raw approach works today and
is forward-compatible with the stable Discord API.
