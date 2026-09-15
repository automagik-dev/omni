-- Agent-run cost on trigger_logs (issue #1183).
--
-- call_agent automation runs now write a trigger_logs row with the tokens and
-- USD cost the provider reported, so per-flow spend is queryable in omni:
--
--   trigger_logs.cost_usd   numeric(15,6), NULL = provider reported no cost.
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
-- No explicit BEGIN/COMMIT — the boot migrator executes this file on a pooled
-- postgres-js connection, which rejects raw transaction control.

ALTER TABLE "trigger_logs"
  ADD COLUMN IF NOT EXISTS "cost_usd" numeric(15, 6);
