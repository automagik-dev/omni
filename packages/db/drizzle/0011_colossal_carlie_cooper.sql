ALTER TABLE "agent_routes" ADD COLUMN "message_debounce_mode" varchar(20);--> statement-breakpoint
ALTER TABLE "agent_routes" ADD COLUMN "message_debounce_min_ms" integer;--> statement-breakpoint
ALTER TABLE "agent_routes" ADD COLUMN "message_debounce_max_ms" integer;--> statement-breakpoint
ALTER TABLE "agent_routes" ADD COLUMN "message_debounce_group_ms" integer;--> statement-breakpoint
ALTER TABLE "agent_routes" ADD COLUMN "message_debounce_restart_on_typing" boolean;--> statement-breakpoint
ALTER TABLE "agent_routes" ADD COLUMN "message_split_delay_mode" varchar(20);--> statement-breakpoint
ALTER TABLE "agent_routes" ADD COLUMN "message_split_delay_fixed_ms" integer;--> statement-breakpoint
ALTER TABLE "agent_routes" ADD COLUMN "message_split_delay_min_ms" integer;--> statement-breakpoint
ALTER TABLE "agent_routes" ADD COLUMN "message_split_delay_max_ms" integer;--> statement-breakpoint
ALTER TABLE "agent_routes" ADD COLUMN "enable_auto_split" boolean;--> statement-breakpoint
ALTER TABLE "agent_routes" ADD COLUMN "reaction_ack" varchar(10);--> statement-breakpoint
ALTER TABLE "agent_routes" ADD COLUMN "reaction_ack_emoji" jsonb;--> statement-breakpoint
ALTER TABLE "agent_routes" ADD COLUMN "ack_timeout_ms" integer;--> statement-breakpoint
ALTER TABLE "agent_routes" ADD COLUMN "agent_ack_message" text;