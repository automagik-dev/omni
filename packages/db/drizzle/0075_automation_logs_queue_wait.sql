-- Queue wait on automation_logs (issue #1206).
--
-- The engine already measured how long a run waited for a concurrency slot
-- (#1181) but only wrote it to the process log, so the API returned no value
-- and "never queued" was indistinguishable from "not recorded":
--
--   automation_logs.queue_wait_ms   integer, 0 = ran immediately,
--                                   NULL = row written before this column.
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
-- No explicit BEGIN/COMMIT — the boot migrator executes this file on a pooled
-- postgres-js connection, which rejects raw transaction control.

ALTER TABLE "automation_logs"
  ADD COLUMN IF NOT EXISTS "queue_wait_ms" integer;
