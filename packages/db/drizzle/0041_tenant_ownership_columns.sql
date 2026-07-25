-- Tenant ownership columns and constraints — additive phase
-- (wish: omni-full-multitenancy, Group G2).
--
-- GENERATED FROM packages/db/src/tenancy-ownership.ts.
-- Regenerate with `bun run scripts/generate-tenant-ownership-sql.ts`;
-- `--check` fails when the committed file drifts from the spec.
--
-- Frozen G0 inputs: OWNERSHIP_MANIFEST.yaml (29 tenant, 7 split, 2 platform
-- legacy tables) and OWNERSHIP_MATRIX.md. ADR-0001 ownership classes,
-- ADR-0002 person/platform identity split, ADR-0004 RLS transaction context
-- (schema only here), ADR-0007 mixed-version writer fence.
--
-- LEGACY-SAFE BY CONSTRUCTION:
--   * `tenant_id` is NULLABLE with no default on all 29 tenant tables. Legacy
--     rows stay valid; NOT NULL waits for the G6 zero-reconciliation gate.
--   * Every pre-existing global unique constraint is untouched, so a pre-G2
--     binary keeps writing successfully (mixed-version state 1).
--   * Tenant-aware unique indexes are PARTIAL on `tenant_id IS NOT NULL`, so
--     they cannot reject any row or write that succeeds today.
--   * Composite same-tenant foreign keys are `NOT VALID`: existing rows are
--     never scanned, and MATCH SIMPLE means a row with a NULL tenant_id is not
--     checked at all. Validation belongs to the later reconciliation gate.
--   * No DROP, no RENAME, no destructive ALTER, no read-path change, no RLS.
--
-- ONLINE DDL: this file is transaction-safe end to end. `ADD COLUMN <uuid>`
-- with no default does not rewrite a table, and `NOT VALID` constraints scan
-- nothing. Indexes on high-volume tables are NOT built here — they are built by
-- the online runner (`packages/db/src/online-ddl.ts`) with
-- CREATE INDEX CONCURRENTLY, which cannot run inside the transaction
-- `applyMigrations()` opens. Every statement is idempotent, so the two phases
-- may run in either order and converge.

-- ---------------------------------------------------------------------------
-- 1. Nullable ownership column on each of the 29 tenant tables.
-- ---------------------------------------------------------------------------
ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "platform_identities" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "chat_participants" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "omni_groups" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "omni_events" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "agent_routes" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "handoff_logs" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "close_contact_logs" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "access_rules" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "batch_jobs" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "media_content" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "chat_id_mappings" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "dead_letter_events" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "event_payloads" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "webhook_sources" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "automation_logs" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "trigger_logs" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "chat_follow_up_state" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
ALTER TABLE "processed_events" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Ownership references the tenant control plane. NOT VALID: no scan, and a
--    tenant can never be cascade-deleted through a business row.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'instances_tenant_fk' AND conrelid = '"instances"'::regclass
    ) THEN
        ALTER TABLE "instances" ADD CONSTRAINT "instances_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'persons_tenant_fk' AND conrelid = '"persons"'::regclass
    ) THEN
        ALTER TABLE "persons" ADD CONSTRAINT "persons_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agents_tenant_fk' AND conrelid = '"agents"'::regclass
    ) THEN
        ALTER TABLE "agents" ADD CONSTRAINT "agents_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'conversations_tenant_fk' AND conrelid = '"conversations"'::regclass
    ) THEN
        ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'platform_identities_tenant_fk' AND conrelid = '"platform_identities"'::regclass
    ) THEN
        ALTER TABLE "platform_identities" ADD CONSTRAINT "platform_identities_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chats_tenant_fk' AND conrelid = '"chats"'::regclass
    ) THEN
        ALTER TABLE "chats" ADD CONSTRAINT "chats_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chat_participants_tenant_fk' AND conrelid = '"chat_participants"'::regclass
    ) THEN
        ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'omni_groups_tenant_fk' AND conrelid = '"omni_groups"'::regclass
    ) THEN
        ALTER TABLE "omni_groups" ADD CONSTRAINT "omni_groups_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'messages_tenant_fk' AND conrelid = '"messages"'::regclass
    ) THEN
        ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'omni_events_tenant_fk' AND conrelid = '"omni_events"'::regclass
    ) THEN
        ALTER TABLE "omni_events" ADD CONSTRAINT "omni_events_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_routes_tenant_fk' AND conrelid = '"agent_routes"'::regclass
    ) THEN
        ALTER TABLE "agent_routes" ADD CONSTRAINT "agent_routes_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_sessions_tenant_fk' AND conrelid = '"agent_sessions"'::regclass
    ) THEN
        ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'handoff_logs_tenant_fk' AND conrelid = '"handoff_logs"'::regclass
    ) THEN
        ALTER TABLE "handoff_logs" ADD CONSTRAINT "handoff_logs_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'close_contact_logs_tenant_fk' AND conrelid = '"close_contact_logs"'::regclass
    ) THEN
        ALTER TABLE "close_contact_logs" ADD CONSTRAINT "close_contact_logs_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'access_rules_tenant_fk' AND conrelid = '"access_rules"'::regclass
    ) THEN
        ALTER TABLE "access_rules" ADD CONSTRAINT "access_rules_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'batch_jobs_tenant_fk' AND conrelid = '"batch_jobs"'::regclass
    ) THEN
        ALTER TABLE "batch_jobs" ADD CONSTRAINT "batch_jobs_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'sync_jobs_tenant_fk' AND conrelid = '"sync_jobs"'::regclass
    ) THEN
        ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'media_content_tenant_fk' AND conrelid = '"media_content"'::regclass
    ) THEN
        ALTER TABLE "media_content" ADD CONSTRAINT "media_content_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chat_id_mappings_tenant_fk' AND conrelid = '"chat_id_mappings"'::regclass
    ) THEN
        ALTER TABLE "chat_id_mappings" ADD CONSTRAINT "chat_id_mappings_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'dead_letter_events_tenant_fk' AND conrelid = '"dead_letter_events"'::regclass
    ) THEN
        ALTER TABLE "dead_letter_events" ADD CONSTRAINT "dead_letter_events_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'event_payloads_tenant_fk' AND conrelid = '"event_payloads"'::regclass
    ) THEN
        ALTER TABLE "event_payloads" ADD CONSTRAINT "event_payloads_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'webhook_sources_tenant_fk' AND conrelid = '"webhook_sources"'::regclass
    ) THEN
        ALTER TABLE "webhook_sources" ADD CONSTRAINT "webhook_sources_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'automations_tenant_fk' AND conrelid = '"automations"'::regclass
    ) THEN
        ALTER TABLE "automations" ADD CONSTRAINT "automations_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'automation_logs_tenant_fk' AND conrelid = '"automation_logs"'::regclass
    ) THEN
        ALTER TABLE "automation_logs" ADD CONSTRAINT "automation_logs_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'trigger_logs_tenant_fk' AND conrelid = '"trigger_logs"'::regclass
    ) THEN
        ALTER TABLE "trigger_logs" ADD CONSTRAINT "trigger_logs_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_tasks_tenant_fk' AND conrelid = '"agent_tasks"'::regclass
    ) THEN
        ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'turns_tenant_fk' AND conrelid = '"turns"'::regclass
    ) THEN
        ALTER TABLE "turns" ADD CONSTRAINT "turns_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chat_follow_up_state_tenant_fk' AND conrelid = '"chat_follow_up_state"'::regclass
    ) THEN
        ALTER TABLE "chat_follow_up_state" ADD CONSTRAINT "chat_follow_up_state_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'processed_events_tenant_fk' AND conrelid = '"processed_events"'::regclass
    ) THEN
        ALTER TABLE "processed_events" ADD CONSTRAINT "processed_events_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Supporting indexes. Every one is `IF NOT EXISTS`, so a fresh install gets
--    a COMPLETE schema from this migration alone.
--
--    On a large database run `bun run db:online-ddl` FIRST: it adds the
--    columns and builds these same indexes with CREATE INDEX CONCURRENTLY,
--    after which every statement below is a no-op and the migration takes no
--    long lock. High-volume tables where that matters:
--    persons, platform_identities, chats, chat_participants, messages, omni_events, media_content, dead_letter_events, event_payloads, automation_logs, trigger_logs, turns, processed_events.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "instances_tenant_idx" ON "instances" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "instances_tenant_id_uq" ON "instances" ("tenant_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "persons_tenant_idx" ON "persons" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "persons_tenant_id_uq" ON "persons" ("tenant_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_tenant_idx" ON "agents" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agents_tenant_id_uq" ON "agents" ("tenant_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_tenant_idx" ON "conversations" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_tenant_id_uq" ON "conversations" ("tenant_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_identities_tenant_idx" ON "platform_identities" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_identities_tenant_id_uq" ON "platform_identities" ("tenant_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chats_tenant_idx" ON "chats" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chats_tenant_id_uq" ON "chats" ("tenant_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_participants_tenant_idx" ON "chat_participants" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "omni_groups_tenant_idx" ON "omni_groups" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_tenant_idx" ON "messages" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messages_tenant_id_uq" ON "messages" ("tenant_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "omni_events_tenant_idx" ON "omni_events" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "omni_events_tenant_id_uq" ON "omni_events" ("tenant_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_routes_tenant_idx" ON "agent_routes" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_routes_tenant_id_uq" ON "agent_routes" ("tenant_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sessions_tenant_idx" ON "agent_sessions" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "handoff_logs_tenant_idx" ON "handoff_logs" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "close_contact_logs_tenant_idx" ON "close_contact_logs" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_rules_tenant_idx" ON "access_rules" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "batch_jobs_tenant_idx" ON "batch_jobs" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "batch_jobs_tenant_id_uq" ON "batch_jobs" ("tenant_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_jobs_tenant_idx" ON "sync_jobs" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_content_tenant_idx" ON "media_content" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_id_mappings_tenant_idx" ON "chat_id_mappings" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dead_letter_events_tenant_idx" ON "dead_letter_events" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_payloads_tenant_idx" ON "event_payloads" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_sources_tenant_idx" ON "webhook_sources" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automations_tenant_idx" ON "automations" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "automations_tenant_id_uq" ON "automations" ("tenant_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_logs_tenant_idx" ON "automation_logs" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trigger_logs_tenant_idx" ON "trigger_logs" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tasks_tenant_idx" ON "agent_tasks" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_tasks_tenant_id_uq" ON "agent_tasks" ("tenant_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "turns_tenant_idx" ON "turns" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_follow_up_state_tenant_idx" ON "chat_follow_up_state" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "processed_events_tenant_idx" ON "processed_events" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "instances_tenant_name_uq" ON "instances" ("tenant_id", "name") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "persons_tenant_phone_uq" ON "persons" ("tenant_id", "primary_phone") WHERE "tenant_id" IS NOT NULL AND "primary_phone" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_identities_tenant_channel_user_uq" ON "platform_identities" ("tenant_id", "channel", "instance_id", "platform_user_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chats_tenant_instance_external_uq" ON "chats" ("tenant_id", "instance_id", "external_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_participants_tenant_chat_user_uq" ON "chat_participants" ("tenant_id", "chat_id", "platform_user_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "omni_groups_tenant_instance_external_uq" ON "omni_groups" ("tenant_id", "instance_id", "external_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messages_tenant_chat_external_uq" ON "messages" ("tenant_id", "chat_id", "external_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_routes_tenant_chat_route_uq" ON "agent_routes" ("tenant_id", "instance_id", "chat_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_routes_tenant_user_route_uq" ON "agent_routes" ("tenant_id", "instance_id", "person_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_sessions_tenant_instance_key_uq" ON "agent_sessions" ("tenant_id", "instance_id", "session_key") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "access_rules_tenant_rule_uq" ON "access_rules" ("tenant_id", "instance_id", "phone_pattern", "rule_type") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_id_mappings_tenant_instance_lid_uq" ON "chat_id_mappings" ("tenant_id", "instance_id", "lid_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_sources_tenant_name_uq" ON "webhook_sources" ("tenant_id", "name") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_follow_up_state_tenant_chat_instance_uq" ON "chat_follow_up_state" ("tenant_id", "chat_id", "instance_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Composite same-tenant foreign keys, all NOT VALID.
--    (tenant_id, <fk>) -> parent (tenant_id, id) makes a cross-tenant join
--    structurally impossible once ownership is populated, while MATCH SIMPLE
--    leaves every NULL-owner legacy row unchecked.
--
--    A composite FK needs a VALID parent (tenant_id, id) unique index. Step 3
--    created it, but an interrupted CONCURRENTLY build from the online phase can
--    leave an INVALID index behind. Rather than fail startup, the DO block warns
--    and skips; `db:online-ddl` repairs the index and re-running migrations
--    adds the constraint.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agents_owner_id_tenant_fk' AND conrelid = '"agents"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'persons_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "owner_id")
                REFERENCES "persons" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'agents_owner_id_tenant_fk', 'persons_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'platform_identities_person_id_tenant_fk' AND conrelid = '"platform_identities"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'persons_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "platform_identities" ADD CONSTRAINT "platform_identities_person_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "person_id")
                REFERENCES "persons" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'platform_identities_person_id_tenant_fk', 'persons_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'platform_identities_instance_id_tenant_fk' AND conrelid = '"platform_identities"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'instances_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "platform_identities" ADD CONSTRAINT "platform_identities_instance_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "instance_id")
                REFERENCES "instances" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'platform_identities_instance_id_tenant_fk', 'instances_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'platform_identities_agent_id_tenant_fk' AND conrelid = '"platform_identities"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'agents_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "platform_identities" ADD CONSTRAINT "platform_identities_agent_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "agent_id")
                REFERENCES "agents" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'platform_identities_agent_id_tenant_fk', 'agents_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chats_instance_id_tenant_fk' AND conrelid = '"chats"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'instances_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "chats" ADD CONSTRAINT "chats_instance_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "instance_id")
                REFERENCES "instances" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'chats_instance_id_tenant_fk', 'instances_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chats_conversation_id_tenant_fk' AND conrelid = '"chats"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'conversations_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "chats" ADD CONSTRAINT "chats_conversation_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "conversation_id")
                REFERENCES "conversations" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'chats_conversation_id_tenant_fk', 'conversations_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chat_participants_chat_id_tenant_fk' AND conrelid = '"chat_participants"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'chats_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_chat_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "chat_id")
                REFERENCES "chats" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'chat_participants_chat_id_tenant_fk', 'chats_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chat_participants_person_id_tenant_fk' AND conrelid = '"chat_participants"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'persons_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_person_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "person_id")
                REFERENCES "persons" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'chat_participants_person_id_tenant_fk', 'persons_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chat_participants_platform_identity_id_tenant_fk' AND conrelid = '"chat_participants"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'platform_identities_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_platform_identity_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "platform_identity_id")
                REFERENCES "platform_identities" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'chat_participants_platform_identity_id_tenant_fk', 'platform_identities_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'omni_groups_instance_id_tenant_fk' AND conrelid = '"omni_groups"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'instances_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "omni_groups" ADD CONSTRAINT "omni_groups_instance_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "instance_id")
                REFERENCES "instances" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'omni_groups_instance_id_tenant_fk', 'instances_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'messages_chat_id_tenant_fk' AND conrelid = '"messages"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'chats_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "chat_id")
                REFERENCES "chats" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'messages_chat_id_tenant_fk', 'chats_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'messages_sender_person_id_tenant_fk' AND conrelid = '"messages"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'persons_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_person_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "sender_person_id")
                REFERENCES "persons" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'messages_sender_person_id_tenant_fk', 'persons_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'messages_sender_platform_identity_id_tenant_fk' AND conrelid = '"messages"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'platform_identities_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_platform_identity_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "sender_platform_identity_id")
                REFERENCES "platform_identities" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'messages_sender_platform_identity_id_tenant_fk', 'platform_identities_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'messages_sender_agent_id_tenant_fk' AND conrelid = '"messages"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'agents_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_agent_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "sender_agent_id")
                REFERENCES "agents" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'messages_sender_agent_id_tenant_fk', 'agents_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'omni_events_instance_id_tenant_fk' AND conrelid = '"omni_events"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'instances_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "omni_events" ADD CONSTRAINT "omni_events_instance_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "instance_id")
                REFERENCES "instances" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'omni_events_instance_id_tenant_fk', 'instances_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'omni_events_person_id_tenant_fk' AND conrelid = '"omni_events"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'persons_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "omni_events" ADD CONSTRAINT "omni_events_person_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "person_id")
                REFERENCES "persons" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'omni_events_person_id_tenant_fk', 'persons_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'omni_events_platform_identity_id_tenant_fk' AND conrelid = '"omni_events"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'platform_identities_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "omni_events" ADD CONSTRAINT "omni_events_platform_identity_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "platform_identity_id")
                REFERENCES "platform_identities" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'omni_events_platform_identity_id_tenant_fk', 'platform_identities_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'omni_events_chat_uuid_tenant_fk' AND conrelid = '"omni_events"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'chats_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "omni_events" ADD CONSTRAINT "omni_events_chat_uuid_tenant_fk"
                FOREIGN KEY ("tenant_id", "chat_uuid")
                REFERENCES "chats" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'omni_events_chat_uuid_tenant_fk', 'chats_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'omni_events_agent_id_tenant_fk' AND conrelid = '"omni_events"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'agents_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "omni_events" ADD CONSTRAINT "omni_events_agent_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "agent_id")
                REFERENCES "agents" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'omni_events_agent_id_tenant_fk', 'agents_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'omni_events_conversation_id_tenant_fk' AND conrelid = '"omni_events"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'conversations_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "omni_events" ADD CONSTRAINT "omni_events_conversation_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "conversation_id")
                REFERENCES "conversations" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'omni_events_conversation_id_tenant_fk', 'conversations_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_routes_instance_id_tenant_fk' AND conrelid = '"agent_routes"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'instances_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "agent_routes" ADD CONSTRAINT "agent_routes_instance_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "instance_id")
                REFERENCES "instances" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'agent_routes_instance_id_tenant_fk', 'instances_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_routes_chat_id_tenant_fk' AND conrelid = '"agent_routes"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'chats_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "agent_routes" ADD CONSTRAINT "agent_routes_chat_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "chat_id")
                REFERENCES "chats" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'agent_routes_chat_id_tenant_fk', 'chats_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_routes_person_id_tenant_fk' AND conrelid = '"agent_routes"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'persons_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "agent_routes" ADD CONSTRAINT "agent_routes_person_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "person_id")
                REFERENCES "persons" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'agent_routes_person_id_tenant_fk', 'persons_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_routes_agent_id_tenant_fk' AND conrelid = '"agent_routes"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'agents_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "agent_routes" ADD CONSTRAINT "agent_routes_agent_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "agent_id")
                REFERENCES "agents" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'agent_routes_agent_id_tenant_fk', 'agents_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_sessions_instance_id_tenant_fk' AND conrelid = '"agent_sessions"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'instances_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_instance_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "instance_id")
                REFERENCES "instances" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'agent_sessions_instance_id_tenant_fk', 'instances_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'handoff_logs_instance_id_tenant_fk' AND conrelid = '"handoff_logs"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'instances_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "handoff_logs" ADD CONSTRAINT "handoff_logs_instance_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "instance_id")
                REFERENCES "instances" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'handoff_logs_instance_id_tenant_fk', 'instances_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'handoff_logs_chat_uuid_tenant_fk' AND conrelid = '"handoff_logs"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'chats_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "handoff_logs" ADD CONSTRAINT "handoff_logs_chat_uuid_tenant_fk"
                FOREIGN KEY ("tenant_id", "chat_uuid")
                REFERENCES "chats" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'handoff_logs_chat_uuid_tenant_fk', 'chats_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'handoff_logs_agent_id_tenant_fk' AND conrelid = '"handoff_logs"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'agents_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "handoff_logs" ADD CONSTRAINT "handoff_logs_agent_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "agent_id")
                REFERENCES "agents" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'handoff_logs_agent_id_tenant_fk', 'agents_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'close_contact_logs_instance_id_tenant_fk' AND conrelid = '"close_contact_logs"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'instances_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "close_contact_logs" ADD CONSTRAINT "close_contact_logs_instance_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "instance_id")
                REFERENCES "instances" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'close_contact_logs_instance_id_tenant_fk', 'instances_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'close_contact_logs_chat_uuid_tenant_fk' AND conrelid = '"close_contact_logs"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'chats_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "close_contact_logs" ADD CONSTRAINT "close_contact_logs_chat_uuid_tenant_fk"
                FOREIGN KEY ("tenant_id", "chat_uuid")
                REFERENCES "chats" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'close_contact_logs_chat_uuid_tenant_fk', 'chats_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'close_contact_logs_agent_id_tenant_fk' AND conrelid = '"close_contact_logs"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'agents_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "close_contact_logs" ADD CONSTRAINT "close_contact_logs_agent_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "agent_id")
                REFERENCES "agents" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'close_contact_logs_agent_id_tenant_fk', 'agents_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'access_rules_instance_id_tenant_fk' AND conrelid = '"access_rules"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'instances_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "access_rules" ADD CONSTRAINT "access_rules_instance_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "instance_id")
                REFERENCES "instances" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'access_rules_instance_id_tenant_fk', 'instances_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'access_rules_person_id_tenant_fk' AND conrelid = '"access_rules"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'persons_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "access_rules" ADD CONSTRAINT "access_rules_person_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "person_id")
                REFERENCES "persons" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'access_rules_person_id_tenant_fk', 'persons_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'batch_jobs_instance_id_tenant_fk' AND conrelid = '"batch_jobs"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'instances_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "batch_jobs" ADD CONSTRAINT "batch_jobs_instance_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "instance_id")
                REFERENCES "instances" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'batch_jobs_instance_id_tenant_fk', 'instances_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'sync_jobs_instance_id_tenant_fk' AND conrelid = '"sync_jobs"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'instances_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_instance_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "instance_id")
                REFERENCES "instances" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'sync_jobs_instance_id_tenant_fk', 'instances_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'media_content_event_id_tenant_fk' AND conrelid = '"media_content"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'omni_events_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "media_content" ADD CONSTRAINT "media_content_event_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "event_id")
                REFERENCES "omni_events" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'media_content_event_id_tenant_fk', 'omni_events_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'media_content_batch_job_id_tenant_fk' AND conrelid = '"media_content"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'batch_jobs_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "media_content" ADD CONSTRAINT "media_content_batch_job_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "batch_job_id")
                REFERENCES "batch_jobs" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'media_content_batch_job_id_tenant_fk', 'batch_jobs_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chat_id_mappings_instance_id_tenant_fk' AND conrelid = '"chat_id_mappings"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'instances_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "chat_id_mappings" ADD CONSTRAINT "chat_id_mappings_instance_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "instance_id")
                REFERENCES "instances" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'chat_id_mappings_instance_id_tenant_fk', 'instances_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'automation_logs_automation_id_tenant_fk' AND conrelid = '"automation_logs"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'automations_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "automation_logs" ADD CONSTRAINT "automation_logs_automation_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "automation_id")
                REFERENCES "automations" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'automation_logs_automation_id_tenant_fk', 'automations_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'trigger_logs_instance_id_tenant_fk' AND conrelid = '"trigger_logs"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'instances_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "trigger_logs" ADD CONSTRAINT "trigger_logs_instance_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "instance_id")
                REFERENCES "instances" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'trigger_logs_instance_id_tenant_fk', 'instances_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'trigger_logs_route_id_tenant_fk' AND conrelid = '"trigger_logs"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'agent_routes_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "trigger_logs" ADD CONSTRAINT "trigger_logs_route_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "route_id")
                REFERENCES "agent_routes" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'trigger_logs_route_id_tenant_fk', 'agent_routes_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_tasks_agent_id_tenant_fk' AND conrelid = '"agent_tasks"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'agents_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_agent_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "agent_id")
                REFERENCES "agents" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'agent_tasks_agent_id_tenant_fk', 'agents_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_tasks_chat_id_tenant_fk' AND conrelid = '"agent_tasks"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'chats_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_chat_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "chat_id")
                REFERENCES "chats" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'agent_tasks_chat_id_tenant_fk', 'chats_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_tasks_conversation_id_tenant_fk' AND conrelid = '"agent_tasks"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'conversations_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_conversation_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "conversation_id")
                REFERENCES "conversations" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'agent_tasks_conversation_id_tenant_fk', 'conversations_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_tasks_message_id_tenant_fk' AND conrelid = '"agent_tasks"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'messages_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_message_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "message_id")
                REFERENCES "messages" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'agent_tasks_message_id_tenant_fk', 'messages_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_tasks_parent_task_id_tenant_fk' AND conrelid = '"agent_tasks"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'agent_tasks_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_parent_task_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "parent_task_id")
                REFERENCES "agent_tasks" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'agent_tasks_parent_task_id_tenant_fk', 'agent_tasks_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'turns_instance_id_tenant_fk' AND conrelid = '"turns"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'instances_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "turns" ADD CONSTRAINT "turns_instance_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "instance_id")
                REFERENCES "instances" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'turns_instance_id_tenant_fk', 'instances_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'turns_agent_id_tenant_fk' AND conrelid = '"turns"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'agents_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "turns" ADD CONSTRAINT "turns_agent_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "agent_id")
                REFERENCES "agents" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'turns_agent_id_tenant_fk', 'agents_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chat_follow_up_state_chat_id_tenant_fk' AND conrelid = '"chat_follow_up_state"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'chats_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "chat_follow_up_state" ADD CONSTRAINT "chat_follow_up_state_chat_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "chat_id")
                REFERENCES "chats" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'chat_follow_up_state_chat_id_tenant_fk', 'chats_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chat_follow_up_state_instance_id_tenant_fk' AND conrelid = '"chat_follow_up_state"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'instances_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "chat_follow_up_state" ADD CONSTRAINT "chat_follow_up_state_instance_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "instance_id")
                REFERENCES "instances" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'chat_follow_up_state_instance_id_tenant_fk', 'instances_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chat_follow_up_state_agent_id_tenant_fk' AND conrelid = '"chat_follow_up_state"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = 'agents_tenant_id_uq' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "chat_follow_up_state" ADD CONSTRAINT "chat_follow_up_state_agent_id_tenant_fk"
                FOREIGN KEY ("tenant_id", "agent_id")
                REFERENCES "agents" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', 'chat_follow_up_state_agent_id_tenant_fk', 'agents_tenant_id_uq';
        END IF;
    END IF;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Trusted dual-write derivation triggers.
--
--    NOT gated by OMNI_MULTITENANCY_ENABLED: an old-shaped write stays valid and
--    leaves ownership NULL, while a write under fully-owned parents persists the
--    derived tenant id even with tenant mode off. That is what stops a pre-G2
--    binary from creating an unowned row beneath an owned parent.
--
--    Tenant identity here comes only from parents already persisted in this
--    database. Request bodies, headers, query metadata, person metadata, the
--    quarantined OmniCustomerContext.tenantId, and OMNI_TENANT_ID are never
--    consulted — the trigger discards any caller-supplied value first.
--
--    `instances` is the sole ownership root (G0) and has NO trigger: its
--    tenant id comes from authenticated server-side context through the
--    dedicated write path in packages/db/src/tenancy-dual-write.ts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_persons"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW."tenant_id" := NULL;
    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'persons_tenant_ownership_trg' AND tgrelid = '"persons"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "persons_tenant_ownership_trg" BEFORE INSERT ON "persons"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_persons"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_agents"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent uuid;
    v_resolved uuid := NULL;
    v_seen boolean := false;
    v_null_parent boolean := false;
BEGIN
    -- Tenant identity is derived, never accepted from the caller.
    NEW."tenant_id" := NULL;

    IF NEW."owner_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "persons" p WHERE p."id" = NEW."owner_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."owner_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    -- Never write a non-null child tenant id above a NULL-owner parent.
    IF NOT v_null_parent THEN
        NEW."tenant_id" := v_resolved;
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'agents_tenant_ownership_trg' AND tgrelid = '"agents"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "agents_tenant_ownership_trg" BEFORE INSERT ON "agents"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_agents"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_conversations"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW."tenant_id" := NULL;
    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'conversations_tenant_ownership_trg' AND tgrelid = '"conversations"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "conversations_tenant_ownership_trg" BEFORE INSERT ON "conversations"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_conversations"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_platform_identities"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent uuid;
    v_resolved uuid := NULL;
    v_seen boolean := false;
    v_null_parent boolean := false;
BEGIN
    -- Tenant identity is derived, never accepted from the caller.
    NEW."tenant_id" := NULL;

    IF NEW."person_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "persons" p WHERE p."id" = NEW."person_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."person_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."instance_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "instances" p WHERE p."id" = NEW."instance_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."instance_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."agent_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "agents" p WHERE p."id" = NEW."agent_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."agent_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    -- Never write a non-null child tenant id above a NULL-owner parent.
    IF NOT v_null_parent THEN
        NEW."tenant_id" := v_resolved;
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'platform_identities_tenant_ownership_trg' AND tgrelid = '"platform_identities"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "platform_identities_tenant_ownership_trg" BEFORE INSERT ON "platform_identities"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_platform_identities"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_chats"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent uuid;
    v_resolved uuid := NULL;
    v_seen boolean := false;
    v_null_parent boolean := false;
BEGIN
    -- Tenant identity is derived, never accepted from the caller.
    NEW."tenant_id" := NULL;

    IF NEW."instance_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "instances" p WHERE p."id" = NEW."instance_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."instance_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."conversation_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "conversations" p WHERE p."id" = NEW."conversation_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."conversation_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    -- Never write a non-null child tenant id above a NULL-owner parent.
    IF NOT v_null_parent THEN
        NEW."tenant_id" := v_resolved;
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'chats_tenant_ownership_trg' AND tgrelid = '"chats"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "chats_tenant_ownership_trg" BEFORE INSERT ON "chats"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_chats"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_chat_participants"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent uuid;
    v_resolved uuid := NULL;
    v_seen boolean := false;
    v_null_parent boolean := false;
BEGIN
    -- Tenant identity is derived, never accepted from the caller.
    NEW."tenant_id" := NULL;

    IF NEW."chat_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "chats" p WHERE p."id" = NEW."chat_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."chat_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."person_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "persons" p WHERE p."id" = NEW."person_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."person_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."platform_identity_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "platform_identities" p WHERE p."id" = NEW."platform_identity_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."platform_identity_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    -- Never write a non-null child tenant id above a NULL-owner parent.
    IF NOT v_null_parent THEN
        NEW."tenant_id" := v_resolved;
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'chat_participants_tenant_ownership_trg' AND tgrelid = '"chat_participants"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "chat_participants_tenant_ownership_trg" BEFORE INSERT ON "chat_participants"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_chat_participants"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_omni_groups"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent uuid;
    v_resolved uuid := NULL;
    v_seen boolean := false;
    v_null_parent boolean := false;
BEGIN
    -- Tenant identity is derived, never accepted from the caller.
    NEW."tenant_id" := NULL;

    IF NEW."instance_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "instances" p WHERE p."id" = NEW."instance_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."instance_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    -- Never write a non-null child tenant id above a NULL-owner parent.
    IF NOT v_null_parent THEN
        NEW."tenant_id" := v_resolved;
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'omni_groups_tenant_ownership_trg' AND tgrelid = '"omni_groups"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "omni_groups_tenant_ownership_trg" BEFORE INSERT ON "omni_groups"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_omni_groups"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_messages"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent uuid;
    v_resolved uuid := NULL;
    v_seen boolean := false;
    v_null_parent boolean := false;
BEGIN
    -- Tenant identity is derived, never accepted from the caller.
    NEW."tenant_id" := NULL;

    IF NEW."chat_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "chats" p WHERE p."id" = NEW."chat_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."chat_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."sender_person_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "persons" p WHERE p."id" = NEW."sender_person_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."sender_person_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."sender_platform_identity_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "platform_identities" p WHERE p."id" = NEW."sender_platform_identity_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."sender_platform_identity_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."sender_agent_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "agents" p WHERE p."id" = NEW."sender_agent_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."sender_agent_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    -- Never write a non-null child tenant id above a NULL-owner parent.
    IF NOT v_null_parent THEN
        NEW."tenant_id" := v_resolved;
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'messages_tenant_ownership_trg' AND tgrelid = '"messages"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "messages_tenant_ownership_trg" BEFORE INSERT ON "messages"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_messages"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_omni_events"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent uuid;
    v_resolved uuid := NULL;
    v_seen boolean := false;
    v_null_parent boolean := false;
BEGIN
    -- Tenant identity is derived, never accepted from the caller.
    NEW."tenant_id" := NULL;

    IF NEW."instance_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "instances" p WHERE p."id" = NEW."instance_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."instance_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."person_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "persons" p WHERE p."id" = NEW."person_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."person_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."platform_identity_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "platform_identities" p WHERE p."id" = NEW."platform_identity_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."platform_identity_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."chat_uuid" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "chats" p WHERE p."id" = NEW."chat_uuid";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."chat_uuid": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."agent_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "agents" p WHERE p."id" = NEW."agent_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."agent_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."conversation_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "conversations" p WHERE p."id" = NEW."conversation_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."conversation_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    -- Never write a non-null child tenant id above a NULL-owner parent.
    IF NOT v_null_parent THEN
        NEW."tenant_id" := v_resolved;
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'omni_events_tenant_ownership_trg' AND tgrelid = '"omni_events"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "omni_events_tenant_ownership_trg" BEFORE INSERT ON "omni_events"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_omni_events"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_agent_routes"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent uuid;
    v_resolved uuid := NULL;
    v_seen boolean := false;
    v_null_parent boolean := false;
BEGIN
    -- Tenant identity is derived, never accepted from the caller.
    NEW."tenant_id" := NULL;

    IF NEW."instance_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "instances" p WHERE p."id" = NEW."instance_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."instance_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."chat_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "chats" p WHERE p."id" = NEW."chat_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."chat_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."person_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "persons" p WHERE p."id" = NEW."person_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."person_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."agent_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "agents" p WHERE p."id" = NEW."agent_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."agent_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    -- Never write a non-null child tenant id above a NULL-owner parent.
    IF NOT v_null_parent THEN
        NEW."tenant_id" := v_resolved;
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'agent_routes_tenant_ownership_trg' AND tgrelid = '"agent_routes"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "agent_routes_tenant_ownership_trg" BEFORE INSERT ON "agent_routes"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_agent_routes"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_agent_sessions"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent uuid;
    v_resolved uuid := NULL;
    v_seen boolean := false;
    v_null_parent boolean := false;
BEGIN
    -- Tenant identity is derived, never accepted from the caller.
    NEW."tenant_id" := NULL;

    IF NEW."instance_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "instances" p WHERE p."id" = NEW."instance_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."instance_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    -- Never write a non-null child tenant id above a NULL-owner parent.
    IF NOT v_null_parent THEN
        NEW."tenant_id" := v_resolved;
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'agent_sessions_tenant_ownership_trg' AND tgrelid = '"agent_sessions"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "agent_sessions_tenant_ownership_trg" BEFORE INSERT ON "agent_sessions"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_agent_sessions"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_handoff_logs"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent uuid;
    v_resolved uuid := NULL;
    v_seen boolean := false;
    v_null_parent boolean := false;
BEGIN
    -- Tenant identity is derived, never accepted from the caller.
    NEW."tenant_id" := NULL;

    IF NEW."instance_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "instances" p WHERE p."id" = NEW."instance_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."instance_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."chat_uuid" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "chats" p WHERE p."id" = NEW."chat_uuid";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."chat_uuid": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."agent_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "agents" p WHERE p."id" = NEW."agent_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."agent_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    -- Never write a non-null child tenant id above a NULL-owner parent.
    IF NOT v_null_parent THEN
        NEW."tenant_id" := v_resolved;
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'handoff_logs_tenant_ownership_trg' AND tgrelid = '"handoff_logs"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "handoff_logs_tenant_ownership_trg" BEFORE INSERT ON "handoff_logs"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_handoff_logs"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_close_contact_logs"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent uuid;
    v_resolved uuid := NULL;
    v_seen boolean := false;
    v_null_parent boolean := false;
BEGIN
    -- Tenant identity is derived, never accepted from the caller.
    NEW."tenant_id" := NULL;

    IF NEW."instance_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "instances" p WHERE p."id" = NEW."instance_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."instance_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."chat_uuid" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "chats" p WHERE p."id" = NEW."chat_uuid";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."chat_uuid": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."agent_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "agents" p WHERE p."id" = NEW."agent_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."agent_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    -- Never write a non-null child tenant id above a NULL-owner parent.
    IF NOT v_null_parent THEN
        NEW."tenant_id" := v_resolved;
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'close_contact_logs_tenant_ownership_trg' AND tgrelid = '"close_contact_logs"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "close_contact_logs_tenant_ownership_trg" BEFORE INSERT ON "close_contact_logs"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_close_contact_logs"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_access_rules"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent uuid;
    v_resolved uuid := NULL;
    v_seen boolean := false;
    v_null_parent boolean := false;
BEGIN
    -- Tenant identity is derived, never accepted from the caller.
    NEW."tenant_id" := NULL;

    IF NEW."instance_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "instances" p WHERE p."id" = NEW."instance_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."instance_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."person_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "persons" p WHERE p."id" = NEW."person_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."person_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    -- Never write a non-null child tenant id above a NULL-owner parent.
    IF NOT v_null_parent THEN
        NEW."tenant_id" := v_resolved;
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'access_rules_tenant_ownership_trg' AND tgrelid = '"access_rules"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "access_rules_tenant_ownership_trg" BEFORE INSERT ON "access_rules"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_access_rules"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_batch_jobs"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent uuid;
    v_resolved uuid := NULL;
    v_seen boolean := false;
    v_null_parent boolean := false;
BEGIN
    -- Tenant identity is derived, never accepted from the caller.
    NEW."tenant_id" := NULL;

    IF NEW."instance_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "instances" p WHERE p."id" = NEW."instance_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."instance_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    -- Never write a non-null child tenant id above a NULL-owner parent.
    IF NOT v_null_parent THEN
        NEW."tenant_id" := v_resolved;
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'batch_jobs_tenant_ownership_trg' AND tgrelid = '"batch_jobs"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "batch_jobs_tenant_ownership_trg" BEFORE INSERT ON "batch_jobs"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_batch_jobs"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_sync_jobs"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent uuid;
    v_resolved uuid := NULL;
    v_seen boolean := false;
    v_null_parent boolean := false;
BEGIN
    -- Tenant identity is derived, never accepted from the caller.
    NEW."tenant_id" := NULL;

    IF NEW."instance_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "instances" p WHERE p."id" = NEW."instance_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."instance_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    -- Never write a non-null child tenant id above a NULL-owner parent.
    IF NOT v_null_parent THEN
        NEW."tenant_id" := v_resolved;
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'sync_jobs_tenant_ownership_trg' AND tgrelid = '"sync_jobs"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "sync_jobs_tenant_ownership_trg" BEFORE INSERT ON "sync_jobs"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_sync_jobs"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_media_content"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent uuid;
    v_resolved uuid := NULL;
    v_seen boolean := false;
    v_null_parent boolean := false;
BEGIN
    -- Tenant identity is derived, never accepted from the caller.
    NEW."tenant_id" := NULL;

    IF NEW."event_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "omni_events" p WHERE p."id" = NEW."event_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."event_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."batch_job_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "batch_jobs" p WHERE p."id" = NEW."batch_job_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."batch_job_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    -- Never write a non-null child tenant id above a NULL-owner parent.
    IF NOT v_null_parent THEN
        NEW."tenant_id" := v_resolved;
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'media_content_tenant_ownership_trg' AND tgrelid = '"media_content"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "media_content_tenant_ownership_trg" BEFORE INSERT ON "media_content"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_media_content"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_chat_id_mappings"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent uuid;
    v_resolved uuid := NULL;
    v_seen boolean := false;
    v_null_parent boolean := false;
BEGIN
    -- Tenant identity is derived, never accepted from the caller.
    NEW."tenant_id" := NULL;

    IF NEW."instance_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "instances" p WHERE p."id" = NEW."instance_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."instance_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    -- Never write a non-null child tenant id above a NULL-owner parent.
    IF NOT v_null_parent THEN
        NEW."tenant_id" := v_resolved;
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'chat_id_mappings_tenant_ownership_trg' AND tgrelid = '"chat_id_mappings"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "chat_id_mappings_tenant_ownership_trg" BEFORE INSERT ON "chat_id_mappings"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_chat_id_mappings"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_dead_letter_events"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW."tenant_id" := NULL;
    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'dead_letter_events_tenant_ownership_trg' AND tgrelid = '"dead_letter_events"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "dead_letter_events_tenant_ownership_trg" BEFORE INSERT ON "dead_letter_events"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_dead_letter_events"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_event_payloads"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW."tenant_id" := NULL;
    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'event_payloads_tenant_ownership_trg' AND tgrelid = '"event_payloads"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "event_payloads_tenant_ownership_trg" BEFORE INSERT ON "event_payloads"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_event_payloads"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_webhook_sources"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW."tenant_id" := NULL;
    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'webhook_sources_tenant_ownership_trg' AND tgrelid = '"webhook_sources"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "webhook_sources_tenant_ownership_trg" BEFORE INSERT ON "webhook_sources"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_webhook_sources"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_automations"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW."tenant_id" := NULL;
    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'automations_tenant_ownership_trg' AND tgrelid = '"automations"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "automations_tenant_ownership_trg" BEFORE INSERT ON "automations"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_automations"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_automation_logs"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent uuid;
    v_resolved uuid := NULL;
    v_seen boolean := false;
    v_null_parent boolean := false;
BEGIN
    -- Tenant identity is derived, never accepted from the caller.
    NEW."tenant_id" := NULL;

    IF NEW."automation_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "automations" p WHERE p."id" = NEW."automation_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."automation_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    -- Never write a non-null child tenant id above a NULL-owner parent.
    IF NOT v_null_parent THEN
        NEW."tenant_id" := v_resolved;
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'automation_logs_tenant_ownership_trg' AND tgrelid = '"automation_logs"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "automation_logs_tenant_ownership_trg" BEFORE INSERT ON "automation_logs"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_automation_logs"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_trigger_logs"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent uuid;
    v_resolved uuid := NULL;
    v_seen boolean := false;
    v_null_parent boolean := false;
BEGIN
    -- Tenant identity is derived, never accepted from the caller.
    NEW."tenant_id" := NULL;

    IF NEW."instance_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "instances" p WHERE p."id" = NEW."instance_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."instance_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."route_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "agent_routes" p WHERE p."id" = NEW."route_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."route_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    -- Never write a non-null child tenant id above a NULL-owner parent.
    IF NOT v_null_parent THEN
        NEW."tenant_id" := v_resolved;
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trigger_logs_tenant_ownership_trg' AND tgrelid = '"trigger_logs"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "trigger_logs_tenant_ownership_trg" BEFORE INSERT ON "trigger_logs"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_trigger_logs"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_agent_tasks"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent uuid;
    v_resolved uuid := NULL;
    v_seen boolean := false;
    v_null_parent boolean := false;
BEGIN
    -- Tenant identity is derived, never accepted from the caller.
    NEW."tenant_id" := NULL;

    IF NEW."agent_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "agents" p WHERE p."id" = NEW."agent_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."agent_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."chat_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "chats" p WHERE p."id" = NEW."chat_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."chat_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."conversation_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "conversations" p WHERE p."id" = NEW."conversation_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."conversation_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."message_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "messages" p WHERE p."id" = NEW."message_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."message_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."parent_task_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "agent_tasks" p WHERE p."id" = NEW."parent_task_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."parent_task_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    -- Never write a non-null child tenant id above a NULL-owner parent.
    IF NOT v_null_parent THEN
        NEW."tenant_id" := v_resolved;
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'agent_tasks_tenant_ownership_trg' AND tgrelid = '"agent_tasks"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "agent_tasks_tenant_ownership_trg" BEFORE INSERT ON "agent_tasks"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_agent_tasks"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_turns"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent uuid;
    v_resolved uuid := NULL;
    v_seen boolean := false;
    v_null_parent boolean := false;
BEGIN
    -- Tenant identity is derived, never accepted from the caller.
    NEW."tenant_id" := NULL;

    IF NEW."instance_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "instances" p WHERE p."id" = NEW."instance_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."instance_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."agent_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "agents" p WHERE p."id" = NEW."agent_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."agent_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    -- Never write a non-null child tenant id above a NULL-owner parent.
    IF NOT v_null_parent THEN
        NEW."tenant_id" := v_resolved;
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'turns_tenant_ownership_trg' AND tgrelid = '"turns"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "turns_tenant_ownership_trg" BEFORE INSERT ON "turns"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_turns"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_chat_follow_up_state"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent uuid;
    v_resolved uuid := NULL;
    v_seen boolean := false;
    v_null_parent boolean := false;
BEGIN
    -- Tenant identity is derived, never accepted from the caller.
    NEW."tenant_id" := NULL;

    IF NEW."chat_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "chats" p WHERE p."id" = NEW."chat_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."chat_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."instance_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "instances" p WHERE p."id" = NEW."instance_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."instance_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."agent_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "agents" p WHERE p."id" = NEW."agent_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."agent_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    -- Never write a non-null child tenant id above a NULL-owner parent.
    IF NOT v_null_parent THEN
        NEW."tenant_id" := v_resolved;
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'chat_follow_up_state_tenant_ownership_trg' AND tgrelid = '"chat_follow_up_state"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "chat_follow_up_state_tenant_ownership_trg" BEFORE INSERT ON "chat_follow_up_state"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_chat_follow_up_state"();
    END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "omni_tenant_ownership_processed_events"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW."tenant_id" := NULL;
    RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'processed_events_tenant_ownership_trg' AND tgrelid = '"processed_events"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "processed_events_tenant_ownership_trg" BEFORE INSERT ON "processed_events"
            FOR EACH ROW EXECUTE FUNCTION "omni_tenant_ownership_processed_events"();
    END IF;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Split destinations — ADDITIVE SCHEMA CONTRACT ONLY.
--
-- G0 marks seven legacy tables `split`. G1 delivered the key/auth/audit split;
-- these are the five that remain. G2 creates the destinations EMPTY: it copies
-- no legacy row, reclassifies nothing, and switches no runtime read or write
-- path. Every legacy table keeps its exact HEAD shape and behaviour. Honouring
-- `split` literally also means none of the five legacy tables receives an
-- ambiguous nullable tenant owner.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "platform_provider_catalog" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "provider_type" varchar(50) NOT NULL,
    "display_name" varchar(255) NOT NULL,
    "description" text,
    "capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "config_schema" jsonb,
    "is_builtin" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "platform_provider_catalog_type_uq" UNIQUE ("provider_type")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tenant_provider_config" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
    "provider_type" varchar(50) NOT NULL,
    "name" varchar(255) NOT NULL,
    "base_url" text,
    "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_provider_config_tenant_name_uq" ON "tenant_provider_config" ("tenant_id", "name");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "platform_settings" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "key" varchar(255) NOT NULL,
    "value" jsonb NOT NULL,
    "description" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "platform_settings_key_uq" UNIQUE ("key")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tenant_settings" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
    "key" varchar(255) NOT NULL,
    "value" jsonb NOT NULL,
    "description" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_settings_tenant_key_uq" ON "tenant_settings" ("tenant_id", "key");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "platform_setting_change_history" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "setting_id" uuid REFERENCES "platform_settings" ("id") ON DELETE RESTRICT,
    "key" varchar(255) NOT NULL,
    "old_value" jsonb,
    "new_value" jsonb,
    "changed_by" varchar(255),
    "reason" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tenant_setting_change_history" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
    "setting_id" uuid REFERENCES "tenant_settings" ("id") ON DELETE RESTRICT,
    "key" varchar(255) NOT NULL,
    "old_value" jsonb,
    "new_value" jsonb,
    "changed_by" varchar(255),
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_setting_change_history_tenant_idx" ON "tenant_setting_change_history" ("tenant_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "platform_plugin_storage" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "plugin_id" varchar(100) NOT NULL,
    "key" varchar(255) NOT NULL,
    "value" jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "platform_plugin_storage_plugin_key_uq" UNIQUE ("plugin_id", "key")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tenant_plugin_storage" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
    "plugin_id" varchar(100) NOT NULL,
    "key" varchar(255) NOT NULL,
    "value" jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_plugin_storage_tenant_plugin_key_uq" ON "tenant_plugin_storage" ("tenant_id", "plugin_id", "key");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "platform_payload_storage_config" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "event_type" varchar(100) NOT NULL,
    "backend" varchar(50) NOT NULL,
    "retention_days" integer,
    "max_payload_bytes" integer,
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "platform_payload_storage_config_event_type_uq" UNIQUE ("event_type")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tenant_payload_storage_overrides" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
    "event_type" varchar(100) NOT NULL,
    "retention_days" integer,
    "max_payload_bytes" integer,
    "quota_bytes" bigint,
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_payload_storage_overrides_tenant_event_uq" ON "tenant_payload_storage_overrides" ("tenant_id", "event_type");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- tenant_migration_ledger — platform migration plane (WISH lines 185-190).
--
-- The contract is CONJUNCTIVE: a row is only a valid ownership decision when it
-- carries source identity, target tenant, the decision rule, a pre-image and a
-- post-image with checksums, an inverse OR an explicit compensating action, the
-- WAL/LSN high-water mark, the writer epoch, status, ambiguity/quarantine state,
-- the reconciliation receipt, and the attempt/checkpoint data an interrupted run
-- needs to resume idempotently.
--
-- The head row is mutable so a resume can advance status/attempt/checkpoint.
-- Every version of it is mirrored into tenant_migration_ledger_history, which
-- is append-only at the database boundary.
--
-- Images are REDACTED projections plus checksums. No plaintext credential,
-- secret value, or unredacted sensitive payload is ever stored here; the
-- checksum is what proves the untouched row, not a copy of it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "tenant_migration_ledger" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "source_table" varchar(63) NOT NULL,
    "source_primary_key" jsonb NOT NULL,
    "target_tenant_id" uuid REFERENCES "tenants" ("id") ON DELETE RESTRICT,
    "decision_rule" text NOT NULL,
    "pre_image_redacted" jsonb NOT NULL,
    "pre_image_checksum" varchar(64) NOT NULL,
    "post_image_redacted" jsonb,
    "post_image_checksum" varchar(64),
    "inverse_action" jsonb,
    "compensating_action" jsonb,
    "wal_lsn_high_water" pg_lsn NOT NULL,
    "writer_epoch" bigint NOT NULL,
    "status" varchar(20) DEFAULT 'planned' NOT NULL,
    "ambiguity_state" varchar(20) DEFAULT 'none' NOT NULL,
    "reconciliation_receipt" jsonb,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "checkpoint" jsonb,
    "redaction_policy" varchar(100) NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "tenant_migration_ledger_status_check"
        CHECK ("status" IN ('planned', 'applied', 'compensated', 'failed', 'quarantined')),
    CONSTRAINT "tenant_migration_ledger_ambiguity_check"
        CHECK ("ambiguity_state" IN ('none', 'ambiguous', 'quarantined')),
    CONSTRAINT "tenant_migration_ledger_checksums_check"
        CHECK ("pre_image_checksum" ~ '^[0-9a-f]{64}$'
           AND ("post_image_checksum" IS NULL OR "post_image_checksum" ~ '^[0-9a-f]{64}$')),
    -- Every decision must be reversible: an inverse action, or an explicit
    -- compensating action when the write is not literally invertible.
    CONSTRAINT "tenant_migration_ledger_inverse_or_compensating_check"
        CHECK ("inverse_action" IS NOT NULL OR "compensating_action" IS NOT NULL),
    -- An applied decision must name the tenant it assigned and carry its post-image.
    CONSTRAINT "tenant_migration_ledger_applied_completeness_check"
        CHECK ("status" <> 'applied'
            OR ("target_tenant_id" IS NOT NULL AND "post_image_checksum" IS NOT NULL
                AND "reconciliation_receipt" IS NOT NULL)),
    -- Ambiguity is never silently resolved into an assignment.
    CONSTRAINT "tenant_migration_ledger_quarantine_check"
        CHECK ("ambiguity_state" = 'none' OR "target_tenant_id" IS NULL),
    CONSTRAINT "tenant_migration_ledger_attempts_check" CHECK ("attempt_count" >= 0),
    CONSTRAINT "tenant_migration_ledger_epoch_check" CHECK ("writer_epoch" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_migration_ledger_source_uq"
    ON "tenant_migration_ledger" ("source_table", "source_primary_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_migration_ledger_status_idx" ON "tenant_migration_ledger" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_migration_ledger_tenant_idx"
    ON "tenant_migration_ledger" ("target_tenant_id") WHERE "target_tenant_id" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tenant_migration_ledger_history" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "ledger_id" uuid NOT NULL,
    "revision" integer NOT NULL,
    "source_table" varchar(63) NOT NULL,
    "source_primary_key" jsonb NOT NULL,
    "target_tenant_id" uuid,
    "decision_rule" text NOT NULL,
    "pre_image_checksum" varchar(64) NOT NULL,
    "post_image_checksum" varchar(64),
    "wal_lsn_high_water" pg_lsn NOT NULL,
    "writer_epoch" bigint NOT NULL,
    "status" varchar(20) NOT NULL,
    "ambiguity_state" varchar(20) NOT NULL,
    "attempt_count" integer NOT NULL,
    "checkpoint" jsonb,
    "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "tenant_migration_ledger_history_revision_uq" UNIQUE ("ledger_id", "revision")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_migration_ledger_history_ledger_idx"
    ON "tenant_migration_ledger_history" ("ledger_id");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "omni_append_migration_ledger_history"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_revision integer;
BEGIN
    SELECT COALESCE(MAX("revision"), 0) + 1 INTO v_revision
    FROM "tenant_migration_ledger_history" WHERE "ledger_id" = NEW."id";

    INSERT INTO "tenant_migration_ledger_history" (
        "ledger_id", "revision", "source_table", "source_primary_key", "target_tenant_id",
        "decision_rule", "pre_image_checksum", "post_image_checksum", "wal_lsn_high_water",
        "writer_epoch", "status", "ambiguity_state", "attempt_count", "checkpoint"
    ) VALUES (
        NEW."id", v_revision, NEW."source_table", NEW."source_primary_key", NEW."target_tenant_id",
        NEW."decision_rule", NEW."pre_image_checksum", NEW."post_image_checksum", NEW."wal_lsn_high_water",
        NEW."writer_epoch", NEW."status", NEW."ambiguity_state", NEW."attempt_count", NEW."checkpoint"
    );
    RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "omni_reject_migration_ledger_history_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'migration ledger history is append-only';
END;
$$;
--> statement-breakpoint

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'tenant_migration_ledger_history_trg' AND tgrelid = '"tenant_migration_ledger"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "tenant_migration_ledger_history_trg"
            AFTER INSERT OR UPDATE ON "tenant_migration_ledger"
            FOR EACH ROW EXECUTE FUNCTION "omni_append_migration_ledger_history"();
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'tenant_migration_ledger_history_immutable_trg' AND tgrelid = '"tenant_migration_ledger_history"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "tenant_migration_ledger_history_immutable_trg"
            BEFORE UPDATE OR DELETE ON "tenant_migration_ledger_history"
            FOR EACH ROW EXECUTE FUNCTION "omni_reject_migration_ledger_history_mutation"();
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'tenant_migration_ledger_history_truncate_trg' AND tgrelid = '"tenant_migration_ledger_history"'::regclass AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER "tenant_migration_ledger_history_truncate_trg"
            BEFORE TRUNCATE ON "tenant_migration_ledger_history"
            FOR EACH STATEMENT EXECUTE FUNCTION "omni_reject_migration_ledger_history_mutation"();
    END IF;
END $$;

