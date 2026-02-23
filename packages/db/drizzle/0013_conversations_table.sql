-- conversations: cross-channel continuity container (omni-233)
-- @see docs/architecture/actor-model.md — Horizon Next
CREATE TABLE "conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" varchar(500),
  "summary" text,
  "state" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "conversations_created_at_idx" ON "conversations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "conversations_updated_at_idx" ON "conversations" USING btree ("updated_at");--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_conversation_id_conversations_id_fk"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chats_conversation_id_idx" ON "chats" USING btree ("conversation_id");--> statement-breakpoint
-- Clean any orphaned conversation_id values before adding FK to omni_events
UPDATE "omni_events" SET "conversation_id" = NULL WHERE "conversation_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "omni_events" ADD CONSTRAINT "omni_events_conversation_id_conversations_id_fk"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Backfill: one Conversation per Chat
DO $$
DECLARE
  chat_row RECORD;
  new_conv_id UUID;
BEGIN
  FOR chat_row IN SELECT id, created_at, updated_at FROM chats WHERE conversation_id IS NULL
  LOOP
    INSERT INTO conversations (id, created_at, updated_at)
    VALUES (gen_random_uuid(), chat_row.created_at, chat_row.updated_at)
    RETURNING id INTO new_conv_id;
    UPDATE chats SET conversation_id = new_conv_id WHERE id = chat_row.id;
  END LOOP;
END $$;
