# Brainstorm Jar

## Raw
- **session-observatory** — Agent session observability layer (#292). Scope unclear — needs decomposition. Issue closed as stale.

## Simmering

## Ready

## Poured
- **fix-omni-bugs-243-244** — API key chat scoping (#244) + event-driven media pipeline (#243). DESIGN.md ready. Council reviewed: APPROVE.
- **route-config-overrides** — Per-user/per-agent debounce/ack/split overrides on routes (#242). DESIGN.md ready. Kills the multi-Omni-installation hack.
- **omni-docs-cleanup** — Complete CLI reference (20 missing command groups, ~80 subcommands) + routing skill rewrite + multi-instance guide (#252, #240). DESIGN.md ready.
- **omni-agentic-cli** — Turn-based execution mode (third provider mode) + 9 multimodal verb commands + PG-backed context + provider-agnostic media (Gemini/ElevenLabs/Groq) + instance scoping + persons CLI (#259). 13 groups, 4 waves. SHIPPED: PR #349 merged 2026-04-05
- **fix-person-deduplication** — Fix identity resolution pipeline: use resolvedSenderPhone for LID linking, cross-instance matching, sync-worker guard, data migration, orphan cleanup. 5 groups, 3 waves. SHIPPED: PR #348 merged 2026-04-05
