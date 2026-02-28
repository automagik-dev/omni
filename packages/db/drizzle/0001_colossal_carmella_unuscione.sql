CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"provider" varchar(50) NOT NULL,
	"model" varchar(120),
	"agent_type" varchar(20) DEFAULT 'assistant' NOT NULL,
	"capabilities" text[] DEFAULT '{}' NOT NULL,
	"owner_id" uuid,
	"agent_provider_id" uuid,
	"config_path" text,
	"is_internal" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instances" DROP CONSTRAINT "instances_agent_provider_id_agent_providers_id_fk";
--> statement-breakpoint
ALTER TABLE "instances" ALTER COLUMN "agent_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "instances" ALTER COLUMN "agent_id" SET DATA TYPE uuid USING CASE WHEN agent_id ~ '^[0-9a-f]{8}-' THEN agent_id::uuid ELSE NULL END;--> statement-breakpoint
ALTER TABLE "agent_routes" ADD COLUMN "agent_fk_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sender_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "omni_events" ADD COLUMN "chat_uuid" uuid;--> statement-breakpoint
ALTER TABLE "omni_events" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "omni_events" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "platform_identities" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_id_persons_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_agent_provider_id_agent_providers_id_fk" FOREIGN KEY ("agent_provider_id") REFERENCES "public"."agent_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_name_idx" ON "agents" USING btree ("name");--> statement-breakpoint
CREATE INDEX "agents_owner_idx" ON "agents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "agents_provider_idx" ON "agents" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "agents_active_idx" ON "agents" USING btree ("is_active");--> statement-breakpoint
ALTER TABLE "agent_routes" ADD CONSTRAINT "agent_routes_agent_fk_id_agents_id_fk" FOREIGN KEY ("agent_fk_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_agent_id_agents_id_fk" FOREIGN KEY ("sender_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "omni_events" ADD CONSTRAINT "omni_events_chat_uuid_chats_id_fk" FOREIGN KEY ("chat_uuid") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "omni_events" ADD CONSTRAINT "omni_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_identities" ADD CONSTRAINT "platform_identities_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_routes_agent_fk_idx" ON "agent_routes" USING btree ("agent_fk_id");--> statement-breakpoint
CREATE INDEX "instances_agent_id_idx" ON "instances" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "messages_sender_agent_idx" ON "messages" USING btree ("sender_agent_id");--> statement-breakpoint
CREATE INDEX "omni_events_agent_id_idx" ON "omni_events" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "omni_events_chat_uuid_idx" ON "omni_events" USING btree ("chat_uuid");--> statement-breakpoint
CREATE INDEX "omni_events_conversation_id_idx" ON "omni_events" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "platform_identities_agent_idx" ON "platform_identities" USING btree ("agent_id");--> statement-breakpoint
ALTER TABLE "instances" DROP COLUMN "agent_provider_id";--> statement-breakpoint
ALTER TABLE "instances" DROP COLUMN "agent_api_url";--> statement-breakpoint
ALTER TABLE "instances" DROP COLUMN "agent_api_key";--> statement-breakpoint
ALTER TABLE "instances" DROP COLUMN "agent_type";--> statement-breakpoint
ALTER TABLE "platform_identities" ADD CONSTRAINT "platform_identities_actor_xor" CHECK (NOT (person_id IS NOT NULL AND agent_id IS NOT NULL));