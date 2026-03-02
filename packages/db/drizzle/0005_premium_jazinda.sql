ALTER TABLE "agent_routes" DROP CONSTRAINT "agent_routes_agent_provider_id_agent_providers_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_routes" DROP CONSTRAINT "agent_routes_agent_fk_id_agents_id_fk";
--> statement-breakpoint
DROP INDEX "agent_routes_agent_fk_idx";--> statement-breakpoint
ALTER TABLE "agent_routes" ALTER COLUMN "agent_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "agent_routes" ALTER COLUMN "agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "agent_card" jsonb;--> statement-breakpoint
ALTER TABLE "agent_routes" ADD CONSTRAINT "agent_routes_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_routes_agent_id_idx" ON "agent_routes" USING btree ("agent_id");--> statement-breakpoint
ALTER TABLE "agent_routes" DROP COLUMN "agent_provider_id";--> statement-breakpoint
ALTER TABLE "agent_routes" DROP COLUMN "agent_type";--> statement-breakpoint
ALTER TABLE "agent_routes" DROP COLUMN "agent_fk_id";