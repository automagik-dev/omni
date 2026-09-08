<!-- adr_topic: mixed_version_writer_fence_rollback -->
# ADR-0007 — Mixed-version writer fence, secure floor, and rollback

- Status: proposed (G0 gate)

## Context
A staged rollout runs old and new binaries/producers simultaneously. Old, tenant-unaware
writers must not race ownership transforms or run after cutover.

## Decision
Explicit machine-checkable states (not a generic feature flag): additive/legacy-safe →
fleet-compatible → backlog-safe → fenced transformation → ownership/RLS enforced →
tenant-safe release → legacy retirement.
- Database migration epoch, binary compatibility epoch, event envelope version, writer-fence epoch, WAL/LSN high-water mark, and minimum accepted producer/consumer versions are machine-checkable; deployment/startup refuses unsafe combinations.
- The **secure rollback floor** begins immediately before the first production ownership/person/key rewrite a pre-tenant build cannot interpret — not when a second tenant is created.
- An immutable approval receipt activates the ownership-write fence in the same control-plane compare-and-set that persists the secure-floor marker; no rewrite begins first. Incompatible writers are rejected; WAL/LSN high-water fixed; backfill + post-snapshot compensation complete; final reconciliation is atomic under the fence.
- Accepted rollbacks after the floor: previous multitenant build, feature-disabled-but-tenant-safe build, or maintenance/read-only with ledger-backed compensation. Disabling RLS, restoring only the pre-migration snapshot while discarding post-snapshot writes, or deploying a pre-tenant build is NOT accepted.
- No second tenant may exist before the secure cutover state.

## Consequences
- G8A delivers the executable state machine and drain proofs; G8C persists the secure-floor marker + fence atomically.

## Preserves
WISH "Mixed-version compatibility state machine" and "Secure rollback floor"; Success Criteria 13, 18.
