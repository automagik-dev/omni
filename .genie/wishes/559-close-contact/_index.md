# Wish — Close-Contact endpoint (#559)

| Field | Value |
|---|---|
| **Issue** | [#559](https://github.com/automagik-dev/omni/issues/559) |
| **Owner** | @namastex888 (Pedro) |
| **Status** | scaffold — design landed, implementation pending |
| **Target** | `dev` → homolog D+1 → prod D+7 |
| **Branch** | `feat/559-close-contact-endpoint` |

## Documents

- [`design.md`](./design.md) — full design doc (20 sections, mirrored from `genie-hapvida/brain/Designs/design-eugenia-close-contact.md`)
- [`EVIDENCE.md`](./EVIDENCE.md) — verification log (filled during implementation)

## Summary

New terminal closure primitive for Eugenia (and other agents) parallel to `/messages/send/handoff`. Key divergence from the original issue: outcome-conditional `closed` flag + escalation rule via `close_contact_logs` history query, so soft outcomes (`redirected_sac`, `unqualified`, `no_response`) reopen passively after a cooldown. Hard outcomes (`won`, `lost`) keep the strong terminal semantics from #559. Loop is bounded by automatic escalation when the same soft outcome fires N times within a window.

See `design.md` §17 for the explicit alignment statement and divergence rationale.

## Phases

1. Scaffold (this PR opens) — branch + wish folder + design doc + draft PR.
2. Backend Omni (Phase 1 of design §12) — types, sender, route, audit table, hooks, dispatcher gate, manual reopen, CLI verb, tests.
3. Tool agno-api (Phase 2) — happens in `genie-hv-eugenia` repo, not here.
4. Eugenia prompts (Phase 3) — Aragão, in `genie-hv-eugenia`.
5. Gupshup Journey (Phase 4) — Henrique, on Gupshup side.
6. QA + rollout (Phase 5/6).

## Coordination

- **Pedro** — this PR (Phases 1) + agno-api tool (Phase 2).
- **Aragão** — Eugenia prompt updates (Phase 3) once tool registered.
- **Henrique/Igor (Gupshup)** — Journey terminal node (Phase 4).
- **Cezar** — review.
