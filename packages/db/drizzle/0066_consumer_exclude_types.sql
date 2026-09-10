-- Durable consumer exclude globs (#1078).
--
-- Adds durable_consumers.exclude_types: a JSON array of event-type globs
-- (same syntax as event_type — exact, or trailing-* prefix) dropped from the
-- consumer's stream. Exclusion wins over inclusion, so `custom.*` minus
-- `custom.chat.*` no longer floods application subscribers with
-- housekeeping (custom.chat.unread-updated, custom.lid-mapping.batch, ...).
-- NULL = nothing excluded (existing consumers are unchanged).
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
--
-- NOTE: no explicit BEGIN/COMMIT — the boot migrator executes this file on a
-- pooled postgres-js connection, which rejects raw transaction control.

ALTER TABLE "durable_consumers"
  ADD COLUMN IF NOT EXISTS "exclude_types" jsonb;
