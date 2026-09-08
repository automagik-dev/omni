-- ASC platform Flow channel — which handoff destination an instance uses.
--
-- The two destinations are MUTUALLY EXCLUSIVE, measured live on atendimento
-- 22286567 (flow #225, 03/09): `POST /transferirHumano` was accepted and the
-- atendimento left "Automático" for "Aguardando atendimento" — at which point
-- the flow STOPPED POLLING. A dead flow never reads `hand_off:"sim"` and never
-- reaches the `genesys_mobile_service` node, so the WDE agent got nothing.
--
--   * 'flow'    — no /transferirHumano; the poll body carries hand_off/fila_vq
--                 and the flow routes to Genesys. THE DEFAULT (Hapvida's case).
--   * 'service' — call /transferirHumano; the ASC's own internal queue works it.
--
-- NULL reads as 'flow' in the plugin, so no backfill and no DEFAULT clause is
-- needed — ADD COLUMN with no default does not rewrite the table.
--
-- Hand-written following the 0052_asc_flow_channel precedent (additive,
-- idempotent). No explicit BEGIN/COMMIT — the boot migrator executes this file
-- on a pooled postgres-js connection, which rejects raw transaction control.

ALTER TABLE "instances"
  ADD COLUMN IF NOT EXISTS "asc_flow_handoff_mode" text;
