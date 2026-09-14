-- Automation replay floor (issue #1147).
--
-- The engine consumes each trigger type through one durable NATS consumer.
-- Disabling the last automation on a trigger only unsubscribes, so the durable
-- keeps its position and re-enabling replays every event published while the
-- automation was off — firing send_message / call_agent retroactively.
--
--   automations.enabled_at   NULL = no floor (unchanged behaviour). Set = the
--                            engine drops trigger events older than it.
--                            Stamped to now() on disabled→enabled; an explicit
--                            `enable --replay-since <ts>` sets it earlier.
--
-- NULL on every existing row, so nothing changes until the next enable.
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
-- No explicit BEGIN/COMMIT — the boot migrator executes this file on a pooled
-- postgres-js connection, which rejects raw transaction control.

ALTER TABLE "automations"
  ADD COLUMN IF NOT EXISTS "enabled_at" timestamp with time zone;
