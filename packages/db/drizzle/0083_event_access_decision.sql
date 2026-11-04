-- Opt-in ingest access verdict on the journal + access-filtered durable consumers.
--
-- When OMNI_JOURNAL_ACCESS_DECISION=true, event persistence records the
-- instance's access verdict for inbound (not-from-me) message.received and
-- reaction.received/removed rows, so a durable consumer can follow only the
-- senders the instance allows (or only the denied ones) without re-running
-- the access check per row. With the flag unset nothing writes the column and
-- every existing consumer keeps the default 'all' filter: behaviour is
-- unchanged for everyone already using the journal.
--
--   omni_events.access_decision      varchar(10), nullable, no default:
--                                    'disabled' | 'allowed' | 'denied', frozen
--                                    at ingest; NULL when not evaluated
--   durable_consumers.access_filter  varchar(10) NOT NULL DEFAULT 'all':
--                                    'all' | 'allowed' | 'denied'
--
-- Numbering: first written as 0080, then 0081; renumbered to 0083 for the
-- agreed merge order #1294 (0080), #1295 (0081), #1298 (0082), #1299 (this
-- one, 0083), per the parallel-worktree rule (file name, journal idx/tag, and
-- a `when` above the previous entry). A migration that landed is never touched.
--
-- Interaction with the #1294 readiness gate: a claimed-but-unfilled row has
-- access_decision NULL until its fill lands. A consumer with BOTH
-- wait_for_ready and an access filter widens the SQL predicate to
-- (access_decision = filter OR journal_ready = false), so the gate can hold
-- the page at that row; the access filter then runs on the surviving page.
-- Without wait_for_ready the plain predicate can skip a row whose fill lands
-- late; wait_for_ready is the fix.
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
-- No explicit BEGIN/COMMIT — the boot migrator executes this file on a pooled
-- postgres-js connection, which rejects raw transaction control.

ALTER TABLE "omni_events"
  ADD COLUMN IF NOT EXISTS "access_decision" varchar(10);
--> statement-breakpoint
ALTER TABLE "durable_consumers"
  ADD COLUMN IF NOT EXISTS "access_filter" varchar(10) NOT NULL DEFAULT 'all';
