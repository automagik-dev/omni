ALTER TABLE "chats" ADD COLUMN "last_message_from_me" boolean;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "visibility" varchar(20) DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "labels" text[] DEFAULT '{}'::text[] NOT NULL;