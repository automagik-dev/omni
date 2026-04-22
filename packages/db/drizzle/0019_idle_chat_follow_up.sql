CREATE TABLE "chat_follow_up_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"agent_id" uuid,
	"sequence_config" jsonb NOT NULL,
	"sequence_index" integer DEFAULT 0 NOT NULL,
	"last_agent_message_at" timestamp with time zone NOT NULL,
	"last_inbound_customer_message_at" timestamp with time zone,
	"next_fire_at" timestamp with time zone,
	"disarm_reason" varchar(32),
	"disarmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_follow_up_state" ADD CONSTRAINT "chat_follow_up_state_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_follow_up_state" ADD CONSTRAINT "chat_follow_up_state_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_follow_up_state" ADD CONSTRAINT "chat_follow_up_state_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_follow_up_state_sweeper_idx" ON "chat_follow_up_state" USING btree ("next_fire_at","disarm_reason");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_follow_up_state_chat_instance_unique" ON "chat_follow_up_state" USING btree ("chat_id","instance_id");--> statement-breakpoint
CREATE INDEX "chat_follow_up_state_chat_idx" ON "chat_follow_up_state" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "chat_follow_up_state_instance_idx" ON "chat_follow_up_state" USING btree ("instance_id");