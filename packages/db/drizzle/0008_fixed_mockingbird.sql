ALTER TABLE "instances" ADD COLUMN "read_receipts" varchar(20) DEFAULT 'on' NOT NULL;--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "group_history_size" integer DEFAULT 50 NOT NULL;