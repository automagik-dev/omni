-- ASC Brazil (ASCWhats GW) channel — per-instance configuration.
--
-- Adds the three instance columns the `@omni/channel-asc` plugin reads:
--   * asc_base_url    — gateway host (null = ASC production)
--   * asc_token       — static access token (`asc-token` header)
--   * asc_originador  — WABA phone number, digits-only E.164
--                       (`originador` header)
-- The optional webhook verify token (ASC's `chave`) reuses the existing
-- shared webhook_verify_token column (Gupshup precedent) — no new column.
--
-- Hand-written following the 0043_hermes_channel precedent (additive,
-- idempotent, no rewrite: ADD COLUMN with no default does not rewrite the
-- table).

-- NOTE: no explicit BEGIN/COMMIT — the boot migrator executes this file on a
-- pooled postgres-js connection, which rejects raw transaction control
-- (UNSAFE_TRANSACTION). Single batch, idempotent statements.

ALTER TABLE "instances"
  ADD COLUMN IF NOT EXISTS "asc_base_url" text,
  ADD COLUMN IF NOT EXISTS "asc_token" text,
  ADD COLUMN IF NOT EXISTS "asc_originador" varchar(32);
