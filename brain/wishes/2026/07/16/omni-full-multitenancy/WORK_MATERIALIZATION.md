---
purpose_id: omni-full-multitenancy
materialized_at: 2026-07-20T19:54:52Z
materialized_by: Cegonha
work_scope: G0-through-G8A-non-production
task_count: 9
g0_task_id: t_mrtn6ah2ac8e9c9c
production_task_count: 0
hold_task_count: 0
---

# Work Materialization — Omni Full Multitenancy

## Task rows

| WISH group | Genie task ID | WISH dependency | Dispatch state at materialization |
|---|---|---|---|
| G0 | `t_mrtn6ah2ac8e9c9c` | none | authorized to dispatch |
| G1 | `t_mrtn6ajg460cc591` | G0 + G0 human/security gate | not authorized to dispatch |
| G2 | `t_mrtn6alpa46a87ce` | G1 | not authorized to dispatch |
| G3 | `t_mrtn6ao152946af7` | G1, G2 | not authorized to dispatch |
| G4 | `t_mrtn6aqqa5ac84ff` | G3 | not authorized to dispatch |
| G5 | `t_mrtn6at68d02fd93` | G3 | not authorized to dispatch |
| G6 | `t_mrtn6avi4f0fa946` | G2, G4, G5 | not authorized to dispatch |
| G7 | `t_mrtn6axs8ee08389` | G4, G5, G6 | not authorized to dispatch |
| G8A | `t_mrtn6b00f92e9869` | G7 | not authorized to dispatch |

Genie v5 task rows do not carry the WISH dependency DAG and therefore report all newly created rows as `ready`. The table above and the WISH are the dispatch authority; board `ready` is not authorization.

## Derived execution waves

1. G0
2. G1, only after the separate G0 human/security gate
3. G2
4. G3
5. G4 and G5 in parallel
6. G6
7. G7
8. G8A

## Non-executable and unmaterialized nodes

No task row was created for `H8.1`, `G8B`, `H8.2`, `G8C`, `H8.3`, `G8D`, `H8.4`, `G8E`, `H9.1`, `G9A`, `H9.2`, or `G9B`. H8.1-H9.2 remain non-executable WISH holds. Every production group remains unmaterialized and unauthorized.

## Verification

- Exact group list: `G0,G1,G2,G3,G4,G5,G6,G7,G8A`
- Expected task count: 9
- Forbidden production/hold task rows found: 0
- Post-approval Claude Fable exact-slice gate: `SHIP`, no blocking findings
- Materialized WISH SHA-256: `80188e4064d323a2183bbbe2876a7cb7a601e1c34a4b2d2fd21bc67e14a167ad`
- Current base commit: `d6c400d05287bbf436ecd7e28c56c845b893afc9`

## Current gate

Only G0 may be claimed. G1 remains prohibited until G0 deliverables pass independent review and Felipe or Leonardo explicitly approves the ownership/trust boundary. No task row or reviewer verdict can satisfy that human gate automatically.
