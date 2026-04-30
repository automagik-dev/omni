-- Close-contact endpoint audit table.
--
-- Records every agent→close-contact event with full payload. Written
-- synchronously in the /messages/send/close-contact route so no data is
-- lost. The route also reads this table at close-time to count recent
-- rows for the same (chat_uuid, outcome) within the configured escalation
-- window — that count drives the auto-promotion of soft outcomes to hard
-- terminal (recorded back as `escalated = TRUE` on the new row). See the
-- design doc at .genie/wishes/559-close-contact/design.md §6 + §8.1 for
-- the loop-bound proof.
--
-- Hot path is the recent-count query, indexed on
-- (chat_uuid, outcome, sent_at). Per-instance BI feed is indexed on
-- (instance_id, sent_at). chat_id and agent_id get their own indexes for
-- support drilldowns.
--
-- The `outcome` column is a varchar(32) free string at the DB level; the
-- TypeScript layer constrains it to the `closeContactOutcomes` const array
-- in `packages/db/src/schema.ts` (kept in sync with `CloseContactOutcome`
-- in `@omni/core/events`). No CHECK constraint here so the BI/CRM tooling
-- can extend the taxonomy without a migration.

CREATE TABLE IF NOT EXISTS "close_contact_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "instance_id" uuid REFERENCES "instances"("id") ON DELETE SET NULL,
  "chat_uuid" uuid REFERENCES "chats"("id") ON DELETE SET NULL,
  "chat_id" varchar(255) NOT NULL,
  "to_phone" varchar(100) NOT NULL,
  "text" text NOT NULL,
  "outcome" varchar(32) NOT NULL,
  "reason" text,
  "close_fields" jsonb,
  "agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "external_message_id" varchar(255),
  "escalated" boolean NOT NULL DEFAULT false,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  "metadata" jsonb
);

CREATE INDEX IF NOT EXISTS "close_contact_logs_chat_outcome_sent_at_idx"
  ON "close_contact_logs" ("chat_uuid", "outcome", "sent_at");
CREATE INDEX IF NOT EXISTS "close_contact_logs_instance_sent_at_idx"
  ON "close_contact_logs" ("instance_id", "sent_at");
CREATE INDEX IF NOT EXISTS "close_contact_logs_chat_id_idx"
  ON "close_contact_logs" ("chat_id");
CREATE INDEX IF NOT EXISTS "close_contact_logs_agent_idx"
  ON "close_contact_logs" ("agent_id");
