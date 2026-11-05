-- Durable consumer tenant ownership (paired-agents R2-3, O11).
-- Stamp new consumers from the authenticated caller, independent of instance
-- restrictions and OMNI_DB_ENFORCEMENT. Existing rows deliberately remain NULL:
-- their tenant cannot be established safely, so tenant keys must not see them.
-- Legacy credentials retain their existing access rules.
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).

ALTER TABLE "durable_consumers"
  ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
