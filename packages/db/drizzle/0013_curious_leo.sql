ALTER TABLE "instances" ADD COLUMN "gupshup_api_key" text;--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "gupshup_app_name" varchar(255);--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "gupshup_source_phone" varchar(20);--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "webhook_verify_token" text;