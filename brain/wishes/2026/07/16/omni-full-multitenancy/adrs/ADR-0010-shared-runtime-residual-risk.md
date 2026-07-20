<!-- adr_topic: shared_runtime_residual_risk -->
# ADR-0010 — Shared-runtime RCE residual risk and required human acceptance

- Status: proposed — REQUIRES EXPLICIT HUMAN/SECURITY ACCEPTANCE AT THE G0 GATE

## Context
The default architecture is a single shared Omni runtime process that can legitimately open a
tenant transaction for every tenant. RLS + composite FKs are defense-in-depth against missed
predicates, IDOR, and query bugs, and they bound the blast radius of such bugs. They do NOT
provide hard containment against a full remote-code-execution compromise of that shared
runtime, which could open a valid transaction for any tenant.

## Decision
- G0 makes this trust assumption EXPLICIT rather than implied.
- The residual "shared-runtime RCE breaks logical isolation" is recorded as ACCEPTED-PENDING-HUMAN-SIGN-OFF.
- The G0 human/security gate (Felipe or Leonardo) must explicitly accept this residual in writing (dated), OR the architecture must escalate to per-tenant service/database credentials or stronger physical isolation BEFORE implementation.
- Any stronger containment requirement is implemented, not implied.

## Consequences
- The G0 gate record must carry the explicit residual-risk acceptance (or an escalation decision) before G1 dispatches.
- No code path may claim hard containment against runtime compromise.

## Preserves
WISH "Database enforcement" RCE paragraph; Success Criterion 17.
