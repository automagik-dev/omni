-- Scheduled outbound messages (#889).
--
-- The omni core had no notion of "send this later". follow-up-sweeper (#404)
-- is the nearest thing, but it is inactivity-driven re-engagement, not a
-- message parked for a specific time.
--
-- Two delivery modes, chosen per channel via the canScheduleMessage capability:
--
--   platform — the channel schedules natively (Slack chat.scheduleMessage).
--              Delivery survives omni being down. external_scheduled_id holds
--              the platform handle used to cancel.
--   local    — omni holds the message and sends it at send_at itself, for
--              channels with no native scheduling.
--
-- The row exists even in platform mode, deliberately: Slack's
-- chat.scheduledMessages.list only returns what the SAME token scheduled, so
-- the platform cannot serve as our source of truth for what is pending.
-- Everything scheduled through omni is recorded here; reconciliation against
-- the platform is best-effort.
--
-- chat_external_id is the PLATFORM id, not chats.id — a message can be
-- scheduled to a conversation we have never persisted.
--
-- Tenancy derives via instance_id (the whatsapp_templates / whatsapp_flow_keys
-- precedent) — no denormalized tenant_id column, so the table stays outside the
-- RLS tenant-table manifest by construction. The sweeper scopes per tenant by
-- restricting to that tenant's instances.
--
-- Hand-written following the 0044-0048 precedent (snapshot drift keeps
-- drizzle-kit generate interactive). Additive + idempotent.

-- NOTE: no explicit BEGIN/COMMIT — the boot migrator executes this file on a
-- pooled postgres-js connection, which rejects raw transaction control
-- (UNSAFE_TRANSACTION).

CREATE TABLE IF NOT EXISTS "scheduled_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "instance_id" uuid NOT NULL,
  "chat_external_id" varchar(255) NOT NULL,
  "thread_external_id" varchar(255),
  "is_thread_broadcast" boolean DEFAULT false NOT NULL,
  "content" jsonb NOT NULL,
  "send_at" timestamp with time zone NOT NULL,
  "delivery_mode" varchar(20) NOT NULL,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "external_scheduled_id" varchar(255),
  "sent_external_id" varchar(255),
  "sent_at" timestamp with time zone,
  "canceled_at" timestamp with time zone,
  "failed_at" timestamp with time zone,
  "last_error" text,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "created_by_agent_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "scheduled_messages"
    ADD CONSTRAINT "scheduled_messages_instance_id_instances_id_fk"
    FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The sweeper's hot path: pending rows whose time has come.
CREATE INDEX IF NOT EXISTS "scheduled_messages_due_idx"
  ON "scheduled_messages" ("status", "send_at");

CREATE INDEX IF NOT EXISTS "scheduled_messages_instance_idx"
  ON "scheduled_messages" ("instance_id", "status");

CREATE INDEX IF NOT EXISTS "scheduled_messages_chat_idx"
  ON "scheduled_messages" ("instance_id", "chat_external_id");
