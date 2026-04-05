CREATE TABLE "turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"chat_id" text NOT NULL,
	"message_id" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"api_key_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"action" varchar(20),
	"nudge_count" integer DEFAULT 0 NOT NULL,
	"messages_sent" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"last_activity_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"closed_reason" text,
	"metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "turns_instance_chat_idx" ON "turns" USING btree ("instance_id","chat_id");--> statement-breakpoint
CREATE INDEX "turns_status_idx" ON "turns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "turns_api_key_idx" ON "turns" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "turns_agent_idx" ON "turns" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "turns_last_activity_idx" ON "turns" USING btree ("last_activity_at");--> statement-breakpoint
CREATE INDEX "turns_open_idx" ON "turns" USING btree ("status","last_activity_at") WHERE "turns"."status" = 'open';