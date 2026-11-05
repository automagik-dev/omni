-- Connectors (wish: connectors-first-slice-clickup, Group 1).
--
-- Two additive tables, one root and one derived:
--
--   connectors                     one connected external account per provider
--                                  manifest; `credentials` is a SEALED JSON blob
--   connector_event_subscriptions  the inbound binding: connector -> provider
--                                  event key -> target automation, with a sealed
--                                  verification secret and delivery counters
--
-- No per-provider DDL: `provider` is a varchar holding the manifest id, so a new
-- provider is a code manifest, not a migration. No `instances` row, no chat and
-- no message column exists here, by design.
--
-- `tenant_id` is nullable through the additive phase (every G2 table is), and
-- both tables carry the `(tenant_id, id)` unique index the composite same-tenant
-- FK needs. The subscription's composite FK is declared after that index exists;
-- the single-column FK keeps ON DELETE CASCADE working while tenant_id is NULL.
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
-- No explicit BEGIN/COMMIT — the boot migrator executes this file on a pooled
-- postgres-js connection, which rejects raw transaction control.

CREATE TABLE IF NOT EXISTS "connectors" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "provider" varchar(64) NOT NULL,
    "name" varchar(255) NOT NULL,
    "credentials" text NOT NULL,
    "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "status" varchar(20) NOT NULL,
    "last_validated_at" timestamp with time zone,
    "last_error" text,
    "last_error_code" varchar(64),
    "created_by" varchar(255),
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "tenant_id" uuid,
    CONSTRAINT "connectors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connectors_tenant_idx" ON "connectors" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "connectors_tenant_id_uq" ON "connectors" ("tenant_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connectors_tenant_provider_idx" ON "connectors" ("tenant_id", "provider");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "connectors_tenant_name_uq" ON "connectors" ("tenant_id", "name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "connector_event_subscriptions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "connector_id" uuid NOT NULL,
    "provider_event_key" varchar(100) NOT NULL,
    "filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "target_automation_id" uuid NOT NULL,
    "verification_secret" text NOT NULL,
    "status" varchar(20) DEFAULT 'active' NOT NULL,
    "last_delivery_at" timestamp with time zone,
    "last_failure_at" timestamp with time zone,
    "consecutive_failures" integer DEFAULT 0 NOT NULL,
    "total_deliveries" integer DEFAULT 0 NOT NULL,
    "total_duplicates" integer DEFAULT 0 NOT NULL,
    "last_error" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "tenant_id" uuid,
    CONSTRAINT "connector_event_subscriptions_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "connectors"("id") ON DELETE cascade,
    CONSTRAINT "connector_event_subscriptions_target_automation_id_automations_id_fk" FOREIGN KEY ("target_automation_id") REFERENCES "automations"("id") ON DELETE cascade,
    CONSTRAINT "connector_event_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_event_subscriptions_connector_idx" ON "connector_event_subscriptions" ("connector_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_event_subscriptions_automation_idx" ON "connector_event_subscriptions" ("target_automation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_event_subscriptions_tenant_idx" ON "connector_event_subscriptions" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "connector_event_subscriptions_tenant_id_uq" ON "connector_event_subscriptions" ("tenant_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "connector_event_subscriptions_binding_uq" ON "connector_event_subscriptions" ("connector_id", "provider_event_key", "target_automation_id");
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'connector_event_subscriptions_connector_tenant_fk'
          AND conrelid = '"connector_event_subscriptions"'::regclass
    ) THEN
        ALTER TABLE "connector_event_subscriptions"
            ADD CONSTRAINT "connector_event_subscriptions_connector_tenant_fk"
            FOREIGN KEY ("tenant_id", "connector_id") REFERENCES "connectors" ("tenant_id", "id");
    END IF;
END $$;
