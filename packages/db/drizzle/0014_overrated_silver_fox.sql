ALTER TABLE "api_keys" ADD COLUMN "active_instance_id" uuid;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "context_instance_id" uuid;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "context_chat_id" uuid;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "context_message_id" uuid;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "context_updated_at" timestamp;