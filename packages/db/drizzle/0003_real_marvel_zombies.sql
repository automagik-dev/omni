ALTER TABLE "instances" ADD COLUMN "replay_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "last_seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "agent_chain_to_instance_id" uuid;--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "chain_mode" varchar(20) DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_agent_chain_to_instance_id_instances_id_fk" FOREIGN KEY ("agent_chain_to_instance_id") REFERENCES "public"."instances"("id") ON DELETE set null ON UPDATE no action;