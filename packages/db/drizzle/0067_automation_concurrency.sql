-- Per-automation concurrency control (issue #1108).
--
-- Runs are queued per INSTANCE with a shared default limit, so there is no way
-- to say "only one run of THIS automation at a time". Any automation whose
-- action reads shared state before writing it (webhook / call_agent) can
-- therefore lose an update: two events for the same business fact both read
-- the pre-write snapshot and both write. The key that identifies the duplicate
-- is only knowable after the handler read the content, so serialization is the
-- only primitive that helps.
--
--   automations.max_concurrency   NULL = unchanged: queue per instance with
--                                 the engine's default limit. Set = the run
--                                 moves to a queue private to this automation
--                                 with this limit; 1 = strict single-flight.
--
--   automations.concurrency_key   NULL = one queue for the whole automation.
--                                 Set = a template over the event payload
--                                 (same engine as conditions/action configs)
--                                 partitioning that queue, so a caller can
--                                 serialize per account / chat / repo instead
--                                 of globally.
--
-- Both NULL on every existing row, so current automations keep today's
-- per-instance queueing byte-for-byte and there is no migration risk.
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
-- No explicit BEGIN/COMMIT — the boot migrator executes this file on a pooled
-- postgres-js connection, which rejects raw transaction control.

ALTER TABLE "automations"
  ADD COLUMN IF NOT EXISTS "max_concurrency" integer;

ALTER TABLE "automations"
  ADD COLUMN IF NOT EXISTS "concurrency_key" text;
