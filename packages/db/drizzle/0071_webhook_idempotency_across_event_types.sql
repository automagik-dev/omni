-- Event-type-scoped ingress idempotency keys (issue #1178).
--
-- A custom idempotency template keyed by entity id collapsed different event
-- types for the same entity (order paid, then shipped) into one duplicate.
-- Custom-template keys are now prefixed with the resolved event type; this
-- column is the explicit opt-in back to cross-type collapsing:
--
--   webhook_sources.idempotency_across_event_types   default false (scoped).
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
-- No explicit BEGIN/COMMIT — the boot migrator executes this file on a pooled
-- postgres-js connection, which rejects raw transaction control.

ALTER TABLE "webhook_sources"
  ADD COLUMN IF NOT EXISTS "idempotency_across_event_types" boolean NOT NULL DEFAULT false;
