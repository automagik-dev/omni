-- Hermes (Mutant WhatsApp gateway) channel — per-instance configuration.
--
-- Adds the five instance columns the `@omni/channel-hermes` plugin reads:
--   * hermes_base_url            — customer-specific API host
--   * hermes_username/password   — sign_in credentials (JWT auth)
--   * hermes_media_id            — Hermes UUID of the WhatsApp line; the
--                                  webhook -> instance resolution key
--   * hermes_template_namespace  — Meta template namespace for HSM sends
--
-- Hand-written following the 0042_whatsapp_cloud_channel precedent (additive,
-- idempotent, no rewrite: ADD COLUMN with no default does not rewrite the
-- table, and the partial index build is small on `instances`).

-- NOTE: no explicit BEGIN/COMMIT — the boot migrator executes this file on a
-- pooled postgres-js connection, which rejects raw transaction control
-- (UNSAFE_TRANSACTION). Single batch, idempotent statements.

ALTER TABLE "instances"
  ADD COLUMN IF NOT EXISTS "hermes_base_url" text,
  ADD COLUMN IF NOT EXISTS "hermes_username" varchar(255),
  ADD COLUMN IF NOT EXISTS "hermes_password" text,
  ADD COLUMN IF NOT EXISTS "hermes_media_id" varchar(64),
  ADD COLUMN IF NOT EXISTS "hermes_template_namespace" varchar(128);

CREATE INDEX IF NOT EXISTS "instances_hermes_media_idx"
  ON "instances" ("hermes_media_id");

