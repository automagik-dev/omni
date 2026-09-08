-- Per-automation transactional publication flag (issue #988, RFC #925 G5).
--
-- The automation executor continues on action failure by design, so an
-- `emit_event` that ran before a later failed action leaves a partial effect
-- on the bus — "partial effects on the bus are the default" (RFC #925 G5).
-- This adds the opt-in per-automation switch:
--
--   automations.transactional_emissions   when true, the run's emit_event
--                                         publishes are accumulated in a
--                                         run-scoped buffer and flushed IN
--                                         ORDER only when every action of the
--                                         run succeeded; a failed/cancelled
--                                         run publishes zero. The DLQ retry
--                                         restarts clean and the #958 derived
--                                         idempotency keys guarantee a
--                                         successful retry does not duplicate.
--                                         Default false: existing automations
--                                         keep today's immediate mid-sequence
--                                         publishing byte-for-byte.
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
-- No explicit BEGIN/COMMIT — the boot migrator executes this file on a pooled
-- postgres-js connection, which rejects raw transaction control.

ALTER TABLE "automations"
  ADD COLUMN IF NOT EXISTS "transactional_emissions" boolean NOT NULL DEFAULT false;
