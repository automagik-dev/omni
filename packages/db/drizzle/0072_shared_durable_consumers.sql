-- Competing (shared) durable consumers (issue #1188).
--
-- Consumers fan out: each name owns a cursor, so N workers on N names each
-- see every event. A shared consumer lets N pullers on ONE name split the
-- stream: pull leases a page (claimed watermark + lease list), ack releases
-- the lease, and an expired lease is redelivered (at-least-once).
--
--   durable_consumers.shared        default false (fan-out, unchanged)
--   durable_consumers.lease_state   jsonb, null unless shared
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
-- No explicit BEGIN/COMMIT — the boot migrator executes this file on a pooled
-- postgres-js connection, which rejects raw transaction control.

ALTER TABLE "durable_consumers"
  ADD COLUMN IF NOT EXISTS "shared" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "durable_consumers"
  ADD COLUMN IF NOT EXISTS "lease_state" jsonb;
