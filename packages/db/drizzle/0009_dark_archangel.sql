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
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_id_persons_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_agent_provider_id_agent_providers_id_fk" FOREIGN KEY ("agent_provider_id") REFERENCES "public"."agent_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_name_idx" ON "agents" USING btree ("name");--> statement-breakpoint
CREATE INDEX "agents_owner_idx" ON "agents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "agents_provider_idx" ON "agents" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "agents_active_idx" ON "agents" USING btree ("is_active");