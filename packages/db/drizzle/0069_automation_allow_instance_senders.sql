-- Per-automation loop-guard opt-in (issue #1148).
--
-- `key.fromMe` is per-observer: with two instances in one WhatsApp group the
-- bot's own messages journal as fromMe:false on the other instance, so an
-- automation filtering on it answers itself. Channel events now carry an
-- observer-independent `senderInstanceId`, and the engine skips events sent
-- by a same-tenant instance unless the automation opts in:
--
--   automations.allow_instance_senders   true = act on messages sent by the
--                                        tenant's own instances. Default false.
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
-- No explicit BEGIN/COMMIT — the boot migrator executes this file on a pooled
-- postgres-js connection, which rejects raw transaction control.

ALTER TABLE "automations"
  ADD COLUMN IF NOT EXISTS "allow_instance_senders" boolean NOT NULL DEFAULT false;
