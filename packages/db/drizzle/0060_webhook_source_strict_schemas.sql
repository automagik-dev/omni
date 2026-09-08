-- Per-source strict schema validation (issue #1000, RFC #925 G1 tail).
--
-- The event schema registry (#959) is opt-in per type: an unregistered event
-- type passes every gate unchanged, so a source can emit types nobody
-- registered and they enter the journal unvalidated — "the bus becomes a
-- payload dump" (RFC #925 G1). This adds the deferred policy switch,
-- per-source:
--
--   webhook_sources.strict_schemas   when true, a delivery resolving to an
--                                    event type with NO enabled registered
--                                    schema is refused and dead-lettered with
--                                    reason `schema_not_registered` (manual
--                                    retry only), mirroring the existing
--                                    `schema_validation_failed` path. Default
--                                    false: existing sources keep pass-through
--                                    until explicitly opted in — this is NOT a
--                                    global default flip.
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
-- No explicit BEGIN/COMMIT — the boot migrator executes this file on a pooled
-- postgres-js connection, which rejects raw transaction control.

ALTER TABLE "webhook_sources"
  ADD COLUMN IF NOT EXISTS "strict_schemas" boolean NOT NULL DEFAULT false;
