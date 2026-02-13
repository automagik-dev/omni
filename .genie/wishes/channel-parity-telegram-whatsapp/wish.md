# Wish: Channel Feature Parity — Telegram ↔ WhatsApp (Baileys)

**Status:** IN_PROGRESS
**Slug:** `channel-parity-telegram-whatsapp`
**Created:** 2026-02-12
**Updated:** 2026-02-13
**Brainstorm:** `.genie/brainstorms/channel-parity-telegram-whatsapp/design.md`

---

## Problem

Telegram and WhatsApp plugins have uneven feature coverage — no single doc shows what each supports, what's missing, or how to translate between them. This makes it impossible to prioritize parity work.

## Summary

Produce a **full parity matrix** auditing all 7 feature groups across Telegram (grammy) and WhatsApp (Baileys), then generate **8 follow-up wish stubs** (one per feature group + Baileys resilience) as a prioritized backlog.

This is an **audit + planning wish** — no implementation, only documentation and wish stubs.

---

## Scope

### IN
- Full capability audit of both plugins against `ChannelCapabilities` interface
- Audit across 7 feature groups:
  1. Streaming/UX
  2. Receipts (read/delivery)
  3. Reactions (inbound + outbound)
  4. Media (images, audio, video, docs, stickers)
  5. Groups/Threads
  6. Interactive UI (buttons/polls)
  7. Identity/Profile/Contacts
- Parity matrix doc at `docs/channel-parity/telegram-whatsapp.md`
- Per-feature verdict: `match` / `degrade` / `blocked` / `out-of-scope`
- 8 follow-up wish stubs in `.genie/wishes/`
- Library-level blockers flagged with specific Baileys/grammy limitation

### OUT
- Implementing any parity gaps (follow-up wishes handle that)
- Adding new channel types (Discord/Slack parity)
- Changes to OpenClaw gateway
- Changes to `ChannelCapabilities` interface itself (follow-up wish if needed)

---

## Key Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| DEC-1 | Markdown output only at `docs/channel-parity/telegram-whatsapp.md` | Human-readable, version-controlled, no tooling overhead |
| DEC-2 | One follow-up wish per feature group (7) + 1 Baileys resilience = 8 wishes | Right granularity — each is a meaningful body of work |
| DEC-3 | Verdicts: `match` / `degrade` / `blocked` / `out-of-scope` | Clear prioritization language |
| DEC-4 | Baileys rate limits ≈ human hand speed, not API throughput | Unofficial WhatsApp Web client; `humanDelay` + `simulateTyping` already in plugin |
| DEC-5 | Baileys resilience is its own wish | Need to discuss insulation from breaking changes / protocol shifts |

---

## Risks

1. **Library-level blockers** — some Telegram features may have no Baileys equivalent. Audit must flag with specific limitation.
2. **Baileys instability** — community-maintained, can break on WhatsApp protocol changes. Covered by dedicated resilience wish.
3. **Rate limit asymmetry** — Telegram bot API has official rate limits; Baileys mimics human speed. Parity on paper ≠ parity in practice. Audit must note throughput differences.

---

## Success Criteria

- [ ] Parity matrix exists at `docs/channel-parity/telegram-whatsapp.md`
- [ ] Every `ChannelCapabilities` flag has an explicit parity verdict
- [ ] All 7 feature groups audited with implementation status (not just declared capabilities)
- [ ] 8 follow-up wish stubs exist in `.genie/wishes/` with scope + acceptance criteria
- [ ] Library-level blockers flagged with specific Baileys/grammy limitation
- [ ] Viable WhatsApp streaming UX strategy documented
- [ ] Reaction translation semantics documented

---

## Execution Groups

### Group A: Deep Audit (P0)

**Goal:** Inspect actual implementations (not just declared capabilities) in both plugins.

**Deliverables:**
- Audit notes covering all 7 feature groups
- Actual implementation status per feature (implemented / sender-only / handler-only / declared-but-not-wired / missing)

**Files to inspect:**
- `packages/channel-telegram/src/capabilities.ts` — declared caps
- `packages/channel-telegram/src/plugin.ts` — sendMessage, dispatchContent, createStreamSender
- `packages/channel-telegram/src/senders/` — text, media, reaction, stream
- `packages/channel-telegram/src/handlers/` — messages, reactions
- `packages/channel-whatsapp/src/capabilities.ts` — declared caps
- `packages/channel-whatsapp/src/plugin.ts` — sendMessage, sendTyping, editMessage, deleteMessage
- `packages/channel-whatsapp/src/senders/` — text, media, reaction, contact, location, sticker, forward, builders
- `packages/channel-whatsapp/src/handlers/` — messages, media, connection, status, all-events
- `packages/channel-sdk/src/types/capabilities.ts` — ChannelCapabilities interface

**Preliminary findings (from brainstorm):**

| Feature | Telegram | WhatsApp | Verdict |
|---------|----------|----------|---------|
| Text send | ✅ `sendTextMessage` | ✅ `sendTextMessage` + `buildText` | match |
| Format conversion | ✅ `markdownToTelegramHtml` | ✅ `markdownToWhatsApp` | match (just shipped) |
| Streaming | ✅ `TelegramStreamSender` | ❌ No StreamSender | **gap** |
| Reactions inbound | ✅ handler | ✅ handler | match |
| Reactions outbound | ✅ `setReaction` sender + wired in plugin | ⚠️ `sendReaction` sender exists but NOT wired in plugin.sendMessage | **gap** |
| Edit message | ✅ via grammy | ✅ implemented in plugin | match |
| Delete message | ✅ via grammy | ✅ implemented in plugin | match |
| Typing | ✅ sendChatAction | ✅ sendPresenceUpdate + humanDelay | match |
| Groups | ✅ canHandleGroups=true | ❌ canHandleGroups=false (deferred) | **gap** |
| Receipts read | ❌ canReceiveReadReceipts=false | ✅ canReceiveReadReceipts=true | **gap (telegram limited)** |
| Receipts delivery | ❌ canReceiveDeliveryReceipts=false | ✅ canReceiveDeliveryReceipts=true | **gap (telegram limited)** |
| Contact send | ⚠️ declared true, check impl | ✅ `senders/contact.ts` | TBD |
| Location send | ⚠️ declared true, check impl | ✅ `senders/location.ts` | TBD |
| Sticker send | ⚠️ declared true, check impl | ✅ `senders/sticker.ts` | TBD |
| Poll send | ✅ declared true | ✅ declared true | TBD (check impl) |
| Forward | ⚠️ declared true, check impl | ✅ `senders/forward.ts` | TBD |
| Buttons/inline keyboard | ✅ declared true | ❌ not declared | **gap** |
| Threads/topics | ✅ declared true | ❌ not applicable | degrade |

**Acceptance criteria:**
- Every row in the table above has a confirmed verdict (not TBD)
- Each "gap" has a note on whether it's library-blocked or just not-yet-implemented

**Validation:** Manual review of completeness

---

### Group B: Parity Matrix Document (P0, depends on A)

**Goal:** Write the canonical parity matrix doc.

**Deliverables:**
- `docs/channel-parity/telegram-whatsapp.md` with:
  - Section per feature group (7 sections)
  - Per-feature: Telegram status, WhatsApp status, verdict, notes
  - `ChannelCapabilities` flag alignment table
  - Degradation strategy rules
  - Library constraints and blockers section

**Acceptance criteria:**
- Doc exists and covers all 7 feature groups
- Every `ChannelCapabilities` flag has an explicit verdict
- Library blockers have specific Baileys/grammy references

**Validation:** `cat docs/channel-parity/telegram-whatsapp.md | wc -l` > 100

---

### Group C: Follow-up Wish Stubs (P0, depends on A)

**Goal:** Generate 8 follow-up wish stubs.

**Deliverables:**
8 wish files in `.genie/wishes/`:
1. `parity-streaming/wish.md` — WhatsApp StreamSender + streaming UX
2. `parity-receipts/wish.md` — Receipt normalization across channels
3. `parity-reactions/wish.md` — Reaction send/receive parity + translation
4. `parity-media/wish.md` — Media handling parity (types, sizes, metadata)
5. `parity-groups/wish.md` — WhatsApp group support
6. `parity-interactive-ui/wish.md` — Polls, buttons, interactive messages
7. `parity-identity/wish.md` — Profile, contacts, presence parity
8. `baileys-resilience/wish.md` — Insulation from Baileys breaking changes

Each wish stub contains:
- Status: `READY`
- Problem statement (from audit findings)
- Scope IN/OUT
- Key acceptance criteria
- Estimated complexity (S/M/L)
- Library blockers (if any)

**Acceptance criteria:**
- All 8 files exist with required sections
- Each references specific audit findings
- Baileys resilience wish covers: version pinning, abstraction layer, fallback strategies

**Validation:** `ls .genie/wishes/parity-* .genie/wishes/baileys-resilience/ | wc -l` = 8 directories

---

## Validation (overall)

```bash
# All docs exist
test -f docs/channel-parity/telegram-whatsapp.md && echo "Matrix: OK"
ls .genie/wishes/parity-*/wish.md .genie/wishes/baileys-resilience/wish.md | wc -l  # Should be 8

# No code changes — lint/typecheck should be unchanged
make check
```

---

## Execution Notes

- Groups A→B→C are sequential (B and C depend on audit findings)
- This is docs-only work — no runtime code changes
- Total: ~3 files to create (1 matrix doc + 8 wish stubs = 9 files)
- Can be done in a single session
