-- instances: agentFkId FK (omni-930)
-- Named agentFkId to avoid clash with existing agentId varchar column.
-- Phase 1: additive only — no drops yet. Phase 3 will rename and drop legacy fields.
ALTER TABLE "instances" ADD COLUMN "agent_fk_id" uuid;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_agent_fk_id_agents_id_fk" FOREIGN KEY ("agent_fk_id") REFERENCES "agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instances_agent_fk_idx" ON "instances" USING btree ("agent_fk_id");--> statement-breakpoint

-- Backfill: link each instance to its corresponding agent row.
-- Agents were created one-per-instance (name = '<instanceName> agent') during omni-aqi backfill.
-- Join on agentProviderId to find the right agent for each instance.
UPDATE "instances" i
SET "agent_fk_id" = a."id"
FROM "agents" a
WHERE a."agent_provider_id" = i."agent_provider_id"
  AND a."is_internal" = true
  AND i."agent_provider_id" IS NOT NULL
  AND i."agent_fk_id" IS NULL;
