-- WhatsApp history-sync settings on instances (issue #1211).
--
-- #1126 made the pairing identity configurable, but only via syncFullHistory,
-- which had no column, so it was unreachable. Persist both per instance:
--
--   instances.history_identity   'desktop' (macOS Desktop + group history) | 'web'
--   instances.sync_full_history  full history push on connect (default false, #70)
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
-- No explicit BEGIN/COMMIT — the boot migrator executes this file on a pooled
-- postgres-js connection, which rejects raw transaction control.

ALTER TABLE "instances"
  ADD COLUMN IF NOT EXISTS "history_identity" varchar(10) DEFAULT 'desktop' NOT NULL;

ALTER TABLE "instances"
  ADD COLUMN IF NOT EXISTS "sync_full_history" boolean DEFAULT false NOT NULL;
