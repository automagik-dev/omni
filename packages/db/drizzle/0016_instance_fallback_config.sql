ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "agent_fallback_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "agent_fallback_message" text;--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "agent_fallback_timeout_ms" integer DEFAULT 600000 NOT NULL;
