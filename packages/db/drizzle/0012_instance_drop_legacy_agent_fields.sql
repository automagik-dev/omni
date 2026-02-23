-- Phase 3: rename agentFkId → agentId, drop legacy agent fields (omni-930)
-- Drop old varchar agent_id first (releases the name for the UUID FK rename)
ALTER TABLE "instances" DROP COLUMN "agent_id";--> statement-breakpoint
-- Rename the UUID FK to agent_id
ALTER TABLE "instances" RENAME COLUMN "agent_fk_id" TO "agent_id";--> statement-breakpoint
-- Drop legacy columns now superseded by the agents FK
ALTER TABLE "instances" DROP COLUMN "agent_provider_id";--> statement-breakpoint
ALTER TABLE "instances" DROP COLUMN "agent_type";--> statement-breakpoint
ALTER TABLE "instances" DROP COLUMN "agent_api_url";--> statement-breakpoint
ALTER TABLE "instances" DROP COLUMN "agent_api_key";--> statement-breakpoint
-- Rename the index to match the new column name
ALTER INDEX "instances_agent_fk_idx" RENAME TO "instances_agent_id_idx";
