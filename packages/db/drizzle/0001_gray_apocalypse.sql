ALTER TABLE "instances" ADD COLUMN "reaction_ack" varchar(10) DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "reaction_ack_emoji" jsonb;--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "ack_timeout_ms" integer DEFAULT 30000 NOT NULL;--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "session_reset" jsonb;