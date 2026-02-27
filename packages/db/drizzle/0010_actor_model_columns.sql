-- platform_identities: agentId FK (omni-lpe)
ALTER TABLE "platform_identities" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "platform_identities" ADD CONSTRAINT "platform_identities_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_identities_agent_idx" ON "platform_identities" USING btree ("agent_id");--> statement-breakpoint
-- messages: senderAgentId FK (omni-h3q)
ALTER TABLE "messages" ADD COLUMN "sender_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_agent_id_agents_id_fk" FOREIGN KEY ("sender_agent_id") REFERENCES "agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_sender_agent_idx" ON "messages" USING btree ("sender_agent_id");--> statement-breakpoint
-- omni_events: agentId FK + chatUuid FK + conversationId (omni-1kn)
-- NOTE: chatId stays as varchar(255) — it stores JIDs, not UUIDs. chatUuid is the new proper FK.
ALTER TABLE "omni_events" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "omni_events" ADD CONSTRAINT "omni_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "omni_events_agent_id_idx" ON "omni_events" USING btree ("agent_id");--> statement-breakpoint
ALTER TABLE "omni_events" ADD COLUMN "chat_uuid" uuid;--> statement-breakpoint
ALTER TABLE "omni_events" ADD CONSTRAINT "omni_events_chat_uuid_chats_id_fk" FOREIGN KEY ("chat_uuid") REFERENCES "chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "omni_events_chat_uuid_idx" ON "omni_events" USING btree ("chat_uuid");--> statement-breakpoint
ALTER TABLE "omni_events" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
CREATE INDEX "omni_events_conversation_id_idx" ON "omni_events" USING btree ("conversation_id");--> statement-breakpoint
-- agent_routes: agentFkId FK (omni-p7r) — named agentFkId to avoid clash with existing agentId varchar
ALTER TABLE "agent_routes" ADD COLUMN "agent_fk_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_routes" ADD CONSTRAINT "agent_routes_agent_fk_id_agents_id_fk" FOREIGN KEY ("agent_fk_id") REFERENCES "agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_routes_agent_fk_idx" ON "agent_routes" USING btree ("agent_fk_id");
