-- causationId in the persisted event journal (#957, RFC #925 G3 feature half).
--
-- `metadata->correlationId` groups a flow (the bag of events); `causation_id`
-- gives the tree — the id of the IMMEDIATE parent event whose consumption
-- caused this one to be published. NULL for root events (external ingress
-- mints a fresh correlation, no parent) and for every pre-existing row
-- (forward-only: the ~349k historical journal events have no derivable
-- parent, no backfill). Not an FK — the parent may never have been persisted
-- or may have been pruned.
--
-- The index serves the `omni events trace` descendants walk
-- (children = rows WHERE causation_id = :id).
--
-- Hand-written following the 0055_asc_flow_handoff_mode precedent (additive,
-- idempotent — the snapshot chain stops at 0026 so drizzle-kit generate is
-- not usable here). No explicit BEGIN/COMMIT — the boot migrator executes
-- this file on a pooled postgres-js connection, which rejects raw transaction
-- control. ADD COLUMN with no default does not rewrite the table.

ALTER TABLE "omni_events"
  ADD COLUMN IF NOT EXISTS "causation_id" uuid;

CREATE INDEX IF NOT EXISTS "omni_events_causation_idx"
  ON "omni_events" ("causation_id");
