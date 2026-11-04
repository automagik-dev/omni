-- Opt-in instance scoping + ownership for durable event consumers.
--
-- Durable consumers are global: they page every instance's journal rows and
-- any key with events:write can pull, ack or delete one by name, regardless
-- of the key's instance restriction. This adds an OPT-IN scoped mode
-- (POST /events/consumers with scoped: true); existing rows and every create
-- without the option keep today's behaviour exactly (scoped defaults false,
-- the other two columns stay NULL).
--
--   durable_consumers.scoped         default false (global, unchanged)
--   durable_consumers.instance_ids   jsonb array of instance UUIDs, NULL unless scoped
--   durable_consumers.owner_key_id   uuid of the registering api_keys row, NULL unless scoped
--
-- owner_key_id carries no foreign key on purpose: Postgres has no
-- ADD CONSTRAINT IF NOT EXISTS, and a revoked or deleted key must not
-- cascade into (or block deleting) the consumer row; an orphaned scoped
-- consumer stays reachable by instance-unrestricted keys.
--
-- Numbering: first written as 0080, renumbered to 0082 (journal idx 82,
-- `when` above 0081) after #1294 (0080_event_journal_ready) and #1295
-- (0081_instances_outbound_pacing) landed on dev, per the parallel-worktree
-- rule in .claude/CLAUDE.md. Remaining agreed order: #1299 (0083),
-- #1300 (0084), #1297 (0085); each renumbers its OWN migration when it merges.
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
-- No explicit BEGIN/COMMIT — the boot migrator executes this file on a pooled
-- postgres-js connection, which rejects raw transaction control.

ALTER TABLE "durable_consumers"
  ADD COLUMN IF NOT EXISTS "scoped" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "durable_consumers"
  ADD COLUMN IF NOT EXISTS "instance_ids" jsonb;
--> statement-breakpoint
ALTER TABLE "durable_consumers"
  ADD COLUMN IF NOT EXISTS "owner_key_id" uuid;
