-- Per-instance dispatch-failure messages, plural (#737 follow-up).
--
-- Replaces the single-text `agent_error_message` (added in 0044) with a jsonb
-- string array `agent_error_messages`: operators can configure several
-- variants and the dispatcher picks one at random per failure. Any value
-- already stored in the old column is carried over as a one-element array.
--
-- Hand-written following the 0043/0044 precedent (snapshot drift keeps
-- drizzle-kit generate interactive). Additive + idempotent statements.

-- NOTE: no explicit BEGIN/COMMIT — the boot migrator executes this file on a
-- pooled postgres-js connection, which rejects raw transaction control
-- (UNSAFE_TRANSACTION).

ALTER TABLE "instances"
  ADD COLUMN IF NOT EXISTS "agent_error_messages" jsonb;

UPDATE "instances"
  SET "agent_error_messages" = to_jsonb(ARRAY["agent_error_message"])
  WHERE "agent_error_message" IS NOT NULL
    AND "agent_error_messages" IS NULL;

ALTER TABLE "instances"
  DROP COLUMN IF EXISTS "agent_error_message";
