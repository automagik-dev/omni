-- agent_tasks: persistent task history for agents (omni-m7m)
-- @see docs/architecture/actor-model.md — "Agent Task (persistent)"
CREATE TABLE "agent_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" uuid NOT NULL,
  "chat_id" uuid NOT NULL,
  "conversation_id" uuid,
  "message_id" uuid,

  "type" varchar(100) NOT NULL,
  "title" varchar(500) NOT NULL,
  "description" text,

  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "progress" integer NOT NULL DEFAULT 0,
  "priority" integer NOT NULL DEFAULT 0,

  "metadata" jsonb NOT NULL DEFAULT '{}',
  "result" jsonb,
  "error" text,

  "parent_task_id" uuid,
  "subtask_count" integer NOT NULL DEFAULT 0,
  "completed_subtask_count" integer NOT NULL DEFAULT 0,

  "created_at" timestamp DEFAULT now() NOT NULL,
  "started_at" timestamp,
  "completed_at" timestamp
);--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_agent_id_agents_id_fk"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_chat_id_chats_id_fk"
  FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_conversation_id_conversations_id_fk"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_message_id_messages_id_fk"
  FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_parent_task_id_agent_tasks_id_fk"
  FOREIGN KEY ("parent_task_id") REFERENCES "agent_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_tasks_agent_id_idx" ON "agent_tasks" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_tasks_chat_id_idx" ON "agent_tasks" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "agent_tasks_conversation_id_idx" ON "agent_tasks" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "agent_tasks_parent_task_id_idx" ON "agent_tasks" USING btree ("parent_task_id");--> statement-breakpoint
CREATE INDEX "agent_tasks_status_idx" ON "agent_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_tasks_agent_chat_idx" ON "agent_tasks" USING btree ("agent_id", "chat_id");--> statement-breakpoint
CREATE INDEX "agent_tasks_agent_status_idx" ON "agent_tasks" USING btree ("agent_id", "status");
