ALTER TABLE "instances" RENAME COLUMN "agent_fallback_timeout_ms" TO "agent_stalled_timeout_ms";--> statement-breakpoint
ALTER TABLE "instances" DROP COLUMN "agent_fallback_enabled";--> statement-breakpoint
ALTER TABLE "instances" DROP COLUMN "agent_fallback_message";