-- Phase 2: rename agentFkId → agentId, drop legacy agent fields (omni-p7r)
-- Drop old varchar agent_id first (releases the name for the UUID FK rename)
ALTER TABLE "agent_routes" DROP COLUMN "agent_id";--> statement-breakpoint
-- Rename the UUID FK to agent_id
ALTER TABLE "agent_routes" RENAME COLUMN "agent_fk_id" TO "agent_id";--> statement-breakpoint
-- Drop legacy columns now superseded by the agents FK
ALTER TABLE "agent_routes" DROP COLUMN "agent_provider_id";--> statement-breakpoint
ALTER TABLE "agent_routes" DROP COLUMN "agent_type";--> statement-breakpoint
-- Rename the index to match the new column name
ALTER INDEX "agent_routes_agent_fk_idx" RENAME TO "agent_routes_agent_id_idx";
