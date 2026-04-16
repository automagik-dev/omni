-- Add `handoff_logs` table to persist every agent→human handoff with full payload.
-- Records instanceId, chatId, toPhone, text, extraInfo, agentId, and externalMessageId
-- so handoffs can be queried, audited, and correlated with omni_events.

CREATE TABLE "handoff_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "instance_id" uuid REFERENCES "instances"("id") ON DELETE SET NULL,
  "chat_uuid" uuid REFERENCES "chats"("id") ON DELETE SET NULL,
  "chat_id" varchar(255) NOT NULL,
  "to_phone" varchar(100) NOT NULL,
  "text" text NOT NULL,
  "extra_info" text,
  "agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "external_message_id" varchar(255),
  "sent_at" timestamp DEFAULT now() NOT NULL,
  "metadata" jsonb
);

CREATE INDEX "handoff_logs_instance_idx" ON "handoff_logs" ("instance_id");
CREATE INDEX "handoff_logs_chat_uuid_idx" ON "handoff_logs" ("chat_uuid");
CREATE INDEX "handoff_logs_chat_id_idx" ON "handoff_logs" ("chat_id");
CREATE INDEX "handoff_logs_sent_at_idx" ON "handoff_logs" ("sent_at");
CREATE INDEX "handoff_logs_agent_idx" ON "handoff_logs" ("agent_id");