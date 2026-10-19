-- Opt-in immediate outbound pacing per instance (Vox fluid-chat PR-B).
--
-- The WhatsApp Baileys plugin holds every outbound send behind a humanized
-- random delay and a typing simulation (anti-ban protection). Both switches
-- were process-wide env vars only. These columns let one instance opt out:
--
--   instances.outbound_pacing           'humanized' (default) | 'immediate'
--   instances.outbound_pacing_override  boolean, default false
--
-- The default 'humanized' keeps every existing row and deployment on today's
-- behaviour; only an explicit 'immediate' skips the delay and the typing
-- simulation. A send request's `pacing` field may always ask for 'humanized';
-- it may ask for 'immediate' only when the instance is already 'immediate' or
-- the operator set outbound_pacing_override = true (otherwise 403), so an API
-- key cannot defeat a humanized instance on its own. The API lets only a
-- full-access ('*') key set outbound_pacing_override to true.
--
-- Numbering: renumbered from 0080 to 0081 after #1294 (0080_event_journal_ready)
-- landed on dev, per the parallel-worktree rule.
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
-- No explicit BEGIN/COMMIT — the boot migrator executes this file on a pooled
-- postgres-js connection, which rejects raw transaction control.

ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "outbound_pacing" varchar(20) DEFAULT 'humanized' NOT NULL;
ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "outbound_pacing_override" boolean DEFAULT false NOT NULL;
