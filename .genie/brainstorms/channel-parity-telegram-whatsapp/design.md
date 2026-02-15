# Design: Channel Parity Telegram ↔ WhatsApp

**WRS:** 100/100
**Date:** 2026-02-13

## Problem

Telegram and WhatsApp plugins have uneven feature coverage — no single doc shows what each supports, what's missing, or how to translate between them. This makes it impossible to prioritize parity work.

## Scope

**IN:** Full audit of all 7 feature groups across both plugins:
1. Streaming/UX
2. Receipts (read/delivery)
3. Reactions
4. Media (images, audio, video, docs, stickers)
5. Groups/Threads
6. Interactive UI (buttons/polls)
7. Identity/Profile/Contacts

Plus: Baileys resilience (how to insulate Omni from Baileys instability).

**OUT:** Implementation of any parity gaps (this is audit + planning only). No new channel types.

## Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| DEC-1 | Output is markdown only at `docs/channel-parity/telegram-whatsapp.md` | Human-readable, version-controlled, no tooling overhead |
| DEC-2 | One follow-up wish per feature group (7) + 1 Baileys resilience wish = 8 wishes | Right granularity — each is a meaningful body of work, not too big, not too small |
| DEC-3 | Each capability gets a verdict: `match` / `degrade` / `blocked` / `out-of-scope` | Clear prioritization language |
| DEC-4 | Baileys rate limits ≈ human hand speed, not API throughput | Baileys is unofficial WhatsApp Web client; `humanDelay` + `simulateTyping` already in plugin — this is the baseline |
| DEC-5 | Baileys resilience is its own wish in the backlog | Need to discuss how to protect against Baileys breaking changes / protocol shifts |

## Risks

1. **Library-level blockers** — some Telegram features may have no Baileys equivalent at all. Audit must flag these explicitly with the specific limitation.
2. **Baileys instability** — community-maintained, can break on WhatsApp protocol changes. "Supported" features may be fragile. Covered by dedicated resilience wish.
3. **Rate limit asymmetry** — Telegram bot API has official rate limits; Baileys mimics human speed. Parity on paper ≠ parity in practice. Audit must note throughput differences per feature.

## Acceptance Criteria

1. Parity matrix doc exists at `docs/channel-parity/telegram-whatsapp.md` with every `ChannelCapabilities` flag mapped
2. Each feature has explicit verdict: `match` / `degrade` / `blocked` / `out-of-scope`
3. 8 follow-up wish stubs exist in `.genie/wishes/` with scope + acceptance criteria
4. Library-level blockers flagged with specific Baileys/grammy limitation

## Deliverables

- `docs/channel-parity/telegram-whatsapp.md` — full parity matrix
- 8 wish stubs in `.genie/wishes/` (7 feature groups + Baileys resilience)

## Handoff

Design validated (WRS 100/100). Run /wish to turn this into an executable plan.
