-- WhatsApp Cloud (Meta Cloud API) channel — Group 1 foundation.
--
-- Adds:
--   * Per-instance Meta config columns on `instances` (phone_number_id, waba_id,
--     access_token, app_id, business_id, api_version, connection_method,
--     display_phone_number, connected_at).
--   * New `whatsapp_templates` table for HSM templates (synced with Meta).
--   * Index on `instances.meta_phone_number_id` for webhook resolution
--     (Meta webhook is global; instance is looked up by phone_number_id).
--
-- Hand-written to mirror the pattern of 0034_instances_require_genie_signature.
-- Run `bunx drizzle-kit generate` after `bun install` to (re)align the
-- snapshot if the schema diverges from what's encoded here.

-- NOTE: no explicit BEGIN/COMMIT — the boot migrator executes this file on a
-- pooled postgres-js connection, which rejects raw transaction control
-- (UNSAFE_TRANSACTION). The file is a single batch (no statement-breakpoints),
-- so it executes atomically anyway, and every statement is idempotent.

-- --------------------------------------------------------------------------
-- instances: WhatsApp Cloud per-instance config
-- --------------------------------------------------------------------------
ALTER TABLE "instances"
  ADD COLUMN IF NOT EXISTS "meta_phone_number_id" varchar(64),
  ADD COLUMN IF NOT EXISTS "meta_waba_id" varchar(64),
  ADD COLUMN IF NOT EXISTS "meta_access_token" text,
  ADD COLUMN IF NOT EXISTS "meta_app_id" varchar(64),
  ADD COLUMN IF NOT EXISTS "meta_business_id" varchar(64),
  ADD COLUMN IF NOT EXISTS "meta_api_version" varchar(16) DEFAULT 'v25.0' NOT NULL,
  ADD COLUMN IF NOT EXISTS "meta_connection_method" varchar(32) DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "meta_display_phone_number" varchar(32),
  ADD COLUMN IF NOT EXISTS "meta_connected_at" timestamptz;

CREATE INDEX IF NOT EXISTS "instances_meta_phone_number_idx"
  ON "instances" ("meta_phone_number_id");

-- --------------------------------------------------------------------------
-- whatsapp_templates: HSM templates (Meta Graph API mirror)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "whatsapp_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "instance_id" uuid NOT NULL REFERENCES "instances"("id") ON DELETE CASCADE,
  "meta_id" varchar(64),
  "waba_id" varchar(64) NOT NULL,
  "name" varchar(255) NOT NULL,
  "language" varchar(16) DEFAULT 'pt_BR' NOT NULL,
  "category" varchar(32) NOT NULL,
  "status" varchar(32) DEFAULT 'PENDING' NOT NULL,
  "components" jsonb,
  "variable_mapping" jsonb,
  "rejection_reason" text,
  "quality_score" varchar(16),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_wa_tpl_instance"
  ON "whatsapp_templates" ("instance_id");

CREATE UNIQUE INDEX IF NOT EXISTS "idx_wa_tpl_instance_name_lang"
  ON "whatsapp_templates" ("instance_id", "name", "language");

CREATE INDEX IF NOT EXISTS "idx_wa_tpl_status"
  ON "whatsapp_templates" ("status");

