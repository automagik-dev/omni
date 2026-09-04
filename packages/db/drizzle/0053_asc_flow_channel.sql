-- ASC platform Flow channel — per-instance configuration.
--
-- Adds the four instance columns the `@omni/channel-asc-flow` plugin reads:
--   * asc_flow_base_url        — platform host (null = the tenant default)
--   * asc_flow_login           — /authuser login
--   * asc_flow_chave           — /authuser chave (secret)
--   * asc_flow_handoff_servico — cod_servico for /transferirHumano
-- The optional webhook verify token reuses the existing shared
-- webhook_verify_token column (Gupshup precedent) — no new column.
--
-- Distinct from the `asc` channel (API Gateway / BSP direct): different
-- endpoints, different credentials, different columns.
--
-- Hand-written following the 0043_hermes_channel precedent (additive,
-- idempotent, no rewrite: ADD COLUMN with no default does not rewrite the
-- table).

-- NOTE: no explicit BEGIN/COMMIT — the boot migrator executes this file on a
-- pooled postgres-js connection, which rejects raw transaction control
-- (UNSAFE_TRANSACTION). Single batch, idempotent statements.

ALTER TABLE "instances"
  ADD COLUMN IF NOT EXISTS "asc_flow_base_url" text,
  ADD COLUMN IF NOT EXISTS "asc_flow_login" text,
  ADD COLUMN IF NOT EXISTS "asc_flow_chave" text,
  ADD COLUMN IF NOT EXISTS "asc_flow_handoff_servico" integer;
