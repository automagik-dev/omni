-- Event schema registry (issue #959, RFC #925 G1).
--
-- event_schemas: one row per event_type carrying the payload contract as a
-- JSON Schema artifact (Zod-first — core definitions export to JSON Schema;
-- external registrations arrive as JSON Schema and are stored as-is). The
-- validation gates (generic webhook ingress, automation emit_event) consult
-- this table BEFORE publishing: an invalid payload goes to dead_letter_events
-- with reason schema_validation_failed and never enters the journal. The
-- registry is opt-in per type — an event_type with no row passes through.
--
-- webhook_sources.event_type_mapping: per-source semantic event-type
-- extraction (e.g. X-GitHub-Event: push -> custom.github.push) instead of
-- collapsing every delivery into custom.webhook.{source}. NULL keeps the
-- legacy collapsed type.
--
-- TENANCY: registrations are global — no tenant_id column, following the
-- scheduled_messages precedent. The RLS coverage gate requires every
-- tenant_id-bearing table to be in the frozen G0 manifest, the G1 tenant
-- plane, or the runtime-denied exclusions; per-tenant registration joins the
-- tenancy machinery additively in the G6+ ownership pass.
--
-- Hand-written following the 0044-0055 precedent (snapshot drift keeps
-- drizzle-kit generate interactive). Additive + idempotent. No explicit
-- BEGIN/COMMIT — the boot migrator executes this file on a pooled postgres-js
-- connection, which rejects raw transaction control.

CREATE TABLE IF NOT EXISTS "event_schemas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_type" varchar(150) NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "schema" jsonb NOT NULL,
  "description" text,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "event_schemas_event_type_unique" UNIQUE("event_type")
);

CREATE UNIQUE INDEX IF NOT EXISTS "event_schemas_event_type_idx" ON "event_schemas" ("event_type");
CREATE INDEX IF NOT EXISTS "event_schemas_enabled_idx" ON "event_schemas" ("enabled");

ALTER TABLE "webhook_sources" ADD COLUMN IF NOT EXISTS "event_type_mapping" jsonb;
