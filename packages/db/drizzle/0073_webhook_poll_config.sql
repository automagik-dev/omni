-- Supervised pull connector config (issue #1186).
--
-- A webhook source with a poll config is polled by the API: its command runs
-- on an interval and each JSON stdout line is ingested as an event. The column
-- holds both the config and the scheduler state (next run, backoff, last run):
--
--   webhook_sources.poll_config   jsonb, NULL = push-only source.
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
-- No explicit BEGIN/COMMIT — the boot migrator executes this file on a pooled
-- postgres-js connection, which rejects raw transaction control.

ALTER TABLE "webhook_sources"
  ADD COLUMN IF NOT EXISTS "poll_config" jsonb;
