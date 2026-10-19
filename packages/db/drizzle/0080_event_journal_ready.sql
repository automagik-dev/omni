-- Opt-in journal readiness gate for durable event consumers (Vox fluid-chat
-- proposal, item 4).
--
-- The ingress claim commits a skeleton omni_events row (no raw_payload, text
-- or chat_id) with its journal_seq before the persistence fill lands. A
-- durable consumer pulling between claim and fill is handed the hollow row,
-- or drops it against payload filters and advances its cursor past it, so the
-- filled row is never delivered.
--
--   omni_events.journal_ready        false while a claimed row awaits its
--                                    fill; the fill sets it true. Default
--                                    true: every other insert and every
--                                    existing row is complete.
--   durable_consumers.wait_for_ready opt-in per consumer: when true, pull and
--                                    shared claims stop before a young
--                                    not-ready row. Default false keeps every
--                                    existing consumer's behaviour unchanged.
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
-- No explicit BEGIN/COMMIT — the boot migrator executes this file on a pooled
-- postgres-js connection, which rejects raw transaction control.

ALTER TABLE "omni_events" ADD COLUMN IF NOT EXISTS "journal_ready" boolean NOT NULL DEFAULT true;

ALTER TABLE "durable_consumers" ADD COLUMN IF NOT EXISTS "wait_for_ready" boolean NOT NULL DEFAULT false;
