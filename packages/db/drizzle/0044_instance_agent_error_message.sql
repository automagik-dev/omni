-- Per-instance dispatch-failure message (#737).
--
-- Adds `agent_error_message` to `instances`: the customer-facing text sent
-- when agent dispatch fails on a non-handoff channel. NULL falls through to
-- the `OMNI_AGENT_DISPATCH_ERROR_MESSAGE` env var, then the built-in default
-- (see resolveDispatchErrorMessage in packages/api agent-dispatcher).
--
-- Hand-written following the 0043_hermes_channel precedent (additive,
-- idempotent, no rewrite: ADD COLUMN with no default does not rewrite the
-- table).

-- NOTE: no explicit BEGIN/COMMIT — the boot migrator executes this file on a
-- pooled postgres-js connection, which rejects raw transaction control
-- (UNSAFE_TRANSACTION). Single idempotent statement.

ALTER TABLE "instances"
  ADD COLUMN IF NOT EXISTS "agent_error_message" text;
