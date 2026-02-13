# Wish: Channel Feature Parity — Telegram ↔ WhatsApp (Baileys)

**Status:** READY
**Slug:** `channel-parity-telegram-whatsapp`
**Created:** 2026-02-12
**Depends on:** `stream-telegram` (for baseline streaming UX patterns)

---

## Summary

Omni’s superpower is translation: normalize cross-channel capabilities so that a human can expect *the same semantics* (as far as each platform/library allows) whether they’re on Telegram or WhatsApp.

This wish produces a **full parity plan + backlog** to bring Telegram and WhatsApp (Baileys) to feature parity wherever possible, and to define **explicit equivalence mappings** (reaction semantics, receipts, presence, media, threads/topics vs groups, etc.) when platforms differ.

Outcome: a prioritized set of follow-up wishes that, over time, make **Telegram + WhatsApp 100% on-par** for all features supported by their libs, plus a clear “translation contract” for features that can’t be 1:1.

---

## Scope

### IN
- Capability audit of:
  - Telegram plugin (`packages/channel-telegram/*`, grammy)
  - WhatsApp Baileys plugin (`packages/channel-whatsapp/*`, baileys)
  - Channel SDK capability flags + messaging abstractions
- A **parity matrix**: features × (Telegram, WhatsApp) with:
  - Supported? (Y/N/Partial)
  - Library constraints
  - UX parity strategy
  - Omni translation semantics (canonical event + payload)
- A backlog (set of follow-up wishes) grouped by octopus teams:
  - **Streaming/UX parity**
  - **Receipts parity**
  - **Reactions parity**
  - **Media parity**
  - **Groups/Threads parity**
  - **Interactive UI parity** (buttons/polls)
  - **Identity/Profile/Contacts parity**
- Concrete implementation strategy for:
  - Stream-like UX on WhatsApp (no editMessage equivalent in most clients)
  - Reaction translation across channels
  - Media “file-system semantics” parity (naming, storage refs, metadata)

### OUT
- Implementing the entire backlog in this wish (this is a planning/meta wish)
- Adding new channel types (Discord/Slack)
- Changes to OpenClaw gateway

---

## Current Known Gaps (Initial Hypotheses)

> These are starting points; the audit will confirm.

### Streaming
- Telegram: supported via `editMessageText` (implemented in `stream-telegram`)
- WhatsApp: lacks safe, native “edit message” parity across clients; Baileys may support edits for fromMe, but UX differs and rate limits differ.
- Parity approach:
  1) Canonical streaming interface stays the same (`StreamSender`),
  2) WhatsApp StreamSender uses a different UX strategy:
     - Option A: send a single “Working…” message + final result (no intermediate edits)
     - Option B: send periodic short progress pings (rate-limited) + final
     - Option C: if edits are reliable in Baileys for fromMe, implement edits with tight guardrails

### Groups / Threads
- Telegram supports topics (forum threads) and rich group controls.
- WhatsApp groups are a different model; Omni should map both into canonical group/thread events.

### Reactions
- Both support emoji reactions, but the raw payloads and constraints differ.
- Omni contract: represent reactions as canonical events:
  - `reaction.added` / `reaction.removed`
  - `{ emoji, messageId, actorId, channel }`
- Translation: ensure you can “replay” a reaction across platforms where supported.

### Receipts
- WhatsApp supports read + delivery receipts.
- Telegram bot receipt semantics differ (often limited). Need explicit parity semantics:
  - define what “delivered” and “read” mean per channel
  - normalize into Omni events with `confidence` / `granularity` flags.

### Interactive UI
- Telegram: inline keyboards/buttons; polls.
- WhatsApp: polls exist; buttons are limited and differ by API/library.
- Need a canonical “interactive message” abstraction with per-channel degradations.

---

## Deliverables

### D1) Parity Matrix Doc
- New doc: `docs/channel-parity/telegram-whatsapp.md`
- Contains:
  - Capability flags alignment (`ChannelCapabilities`)
  - Per-feature mapping notes
  - “Degradation strategy” rules

### D2) Follow-up Wish Backlog
- Generate N follow-up wish stubs under `.genie/wishes/` (READY) with:
  - scope
  - acceptance criteria
  - validation commands
  - team ownership label (security / dead-code / perf / parity / streaming)

### D3) Canonical Translation Contracts
- Document canonical event payloads for:
  - reactions
  - receipts
  - typing/presence
  - media attachments
  - threads/topics/groups

---

## Success Criteria
- [ ] Parity matrix exists and is accurate against current code
- [ ] Every capability flag has an explicit parity decision (match / degrade / out-of-scope)
- [ ] Backlog of follow-up wishes exists with clear acceptance criteria
- [ ] Defines at least one viable WhatsApp streaming UX plan aligned with `StreamSender`
- [ ] Defines reaction translation semantics across Telegram ↔ WhatsApp

---

## Execution Groups

### Group 1: Audit + Matrix (P0)
- Inspect Telegram + WhatsApp plugins
- Map features to `ChannelCapabilities`
- Output `docs/channel-parity/telegram-whatsapp.md`

### Group 2: Translation Contracts (P0)
- Define canonical Omni event contracts for key features

### Group 3: Backlog Generation (P0)
- Create follow-up wishes (one per major parity gap)

---

## Validation
- `make lint`
- `make typecheck`
- (Docs-only changes for this wish; no runtime behavior required)
