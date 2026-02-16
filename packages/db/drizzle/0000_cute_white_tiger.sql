CREATE TABLE "access_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid,
	"rule_type" varchar(10) NOT NULL,
	"phone_pattern" varchar(50),
	"platform_user_id" varchar(255),
	"person_id" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"reason" text,
	"expires_at" timestamp,
	"action" varchar(20) DEFAULT 'block' NOT NULL,
	"block_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"schema" varchar(20) DEFAULT 'agno' NOT NULL,
	"base_url" text NOT NULL,
	"api_key" text,
	"schema_config" jsonb,
	"default_stream" boolean DEFAULT true NOT NULL,
	"default_timeout" integer DEFAULT 60 NOT NULL,
	"supports_streaming" boolean DEFAULT true NOT NULL,
	"supports_images" boolean DEFAULT false NOT NULL,
	"supports_audio" boolean DEFAULT false NOT NULL,
	"supports_documents" boolean DEFAULT false NOT NULL,
	"description" text,
	"tags" text[],
	"is_active" boolean DEFAULT true NOT NULL,
	"last_health_check" timestamp,
	"last_health_status" varchar(20),
	"last_health_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_providers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "agent_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"scope" varchar(20) NOT NULL,
	"chat_id" uuid,
	"person_id" uuid,
	"agent_provider_id" uuid NOT NULL,
	"agent_id" varchar(255) NOT NULL,
	"agent_type" varchar(20) DEFAULT 'agent' NOT NULL,
	"agent_timeout" integer,
	"agent_stream_mode" boolean,
	"agent_reply_filter" jsonb,
	"agent_session_strategy" varchar(20),
	"agent_prefix_sender_name" boolean,
	"agent_wait_for_media" boolean,
	"agent_send_media_path" boolean,
	"agent_gate_enabled" boolean,
	"agent_gate_model" varchar(120),
	"agent_gate_prompt" text,
	"label" varchar(255),
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scope_check" CHECK ((scope = 'chat' AND chat_id IS NOT NULL AND person_id IS NULL) OR (scope = 'user' AND person_id IS NOT NULL AND chat_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE "agent_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"session_key" varchar(512) NOT NULL,
	"provider_session_data" jsonb NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_key_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_key_id" uuid NOT NULL,
	"method" varchar(10) NOT NULL,
	"path" varchar(500) NOT NULL,
	"status_code" integer NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"response_time_ms" integer,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"key_prefix" varchar(12) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"scopes" text[] NOT NULL,
	"instance_ids" uuid[],
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"rate_limit" integer,
	"expires_at" timestamp,
	"last_used_at" timestamp,
	"last_used_ip" varchar(45),
	"usage_count" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp,
	"revoked_by" varchar(255),
	"revoke_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar(255),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"event_id" varchar(36) NOT NULL,
	"status" varchar(20) NOT NULL,
	"conditions_matched" boolean NOT NULL,
	"actions_executed" jsonb,
	"error" text,
	"execution_time_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"trigger_event_type" varchar(255) NOT NULL,
	"trigger_conditions" jsonb,
	"condition_logic" varchar(10) DEFAULT 'and',
	"actions" jsonb NOT NULL,
	"debounce" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" varchar(50) NOT NULL,
	"instance_id" uuid,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"request_params" jsonb,
	"total_items" integer DEFAULT 0 NOT NULL,
	"processed_items" integer DEFAULT 0 NOT NULL,
	"failed_items" integer DEFAULT 0 NOT NULL,
	"current_item" varchar(255),
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"total_cost_usd" integer,
	"total_tokens" integer,
	"error_message" text,
	"errors" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "chat_id_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"lid_id" varchar(255) NOT NULL,
	"phone_id" varchar(255) NOT NULL,
	"discovered_at" timestamp DEFAULT now() NOT NULL,
	"discovered_from" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "chat_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"person_id" uuid,
	"platform_identity_id" uuid,
	"platform_user_id" varchar(255) NOT NULL,
	"display_name" varchar(255),
	"avatar_url" text,
	"role" varchar(50),
	"is_active" boolean DEFAULT true NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"left_at" timestamp,
	"last_seen_at" timestamp,
	"message_count" integer DEFAULT 0 NOT NULL,
	"platform_metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid,
	"external_id" varchar(255) NOT NULL,
	"canonical_id" varchar(255),
	"chat_type" varchar(50) NOT NULL,
	"channel" varchar(50) NOT NULL,
	"name" varchar(255),
	"description" text,
	"avatar_url" text,
	"parent_chat_id" uuid,
	"participant_count" integer DEFAULT 0 NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp,
	"last_message_preview" text,
	"settings" jsonb,
	"platform_metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "consumer_offsets" (
	"consumer_name" varchar(100) PRIMARY KEY NOT NULL,
	"stream_name" varchar(50) NOT NULL,
	"last_sequence" integer DEFAULT 0 NOT NULL,
	"last_event_id" uuid,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dead_letter_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" varchar(36) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"subject" varchar(255) NOT NULL,
	"payload" jsonb NOT NULL,
	"error" text NOT NULL,
	"stack" text,
	"auto_retry_count" integer DEFAULT 0 NOT NULL,
	"manual_retry_count" integer DEFAULT 0 NOT NULL,
	"next_auto_retry_at" timestamp,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_retry_at" timestamp,
	"resolved_at" timestamp,
	"resolved_by" varchar(100)
);
--> statement-breakpoint
CREATE TABLE "event_payloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" varchar(36) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"stage" varchar(50) NOT NULL,
	"payload_compressed" text NOT NULL,
	"payload_size_original" integer,
	"payload_size_compressed" integer,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"contains_media" boolean DEFAULT false NOT NULL,
	"contains_base64" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" varchar(100),
	"delete_reason" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "global_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" text,
	"value_type" varchar(20) DEFAULT 'string' NOT NULL,
	"category" varchar(50),
	"description" text,
	"is_secret" boolean DEFAULT false NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"default_value" text,
	"validation_rules" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar(255),
	"updated_by" varchar(255),
	CONSTRAINT "global_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"channel" varchar(50) NOT NULL,
	"session_path" text,
	"session_id_prefix" varchar(50),
	"discord_bot_token" text,
	"discord_client_id" varchar(50),
	"discord_guild_ids" text[],
	"discord_default_channel_id" varchar(50),
	"discord_voice_enabled" boolean DEFAULT false,
	"discord_slash_commands_enabled" boolean DEFAULT true,
	"discord_webhook_url" text,
	"discord_permissions" integer,
	"slack_bot_token" text,
	"slack_app_token" text,
	"slack_signing_secret" text,
	"slack_team_id" varchar(50),
	"telegram_bot_token" text,
	"agent_provider_id" uuid,
	"agent_api_url" text,
	"agent_api_key" text,
	"agent_id" varchar(255) DEFAULT 'default',
	"agent_type" varchar(20) DEFAULT 'agent' NOT NULL,
	"agent_timeout" integer DEFAULT 60 NOT NULL,
	"agent_stream_mode" boolean DEFAULT false NOT NULL,
	"agent_reply_filter" jsonb,
	"agent_session_strategy" varchar(20) DEFAULT 'per_chat' NOT NULL,
	"agent_prefix_sender_name" boolean DEFAULT true NOT NULL,
	"trigger_events" jsonb DEFAULT '["message.received"]'::jsonb,
	"trigger_reactions" jsonb,
	"trigger_mention_patterns" jsonb,
	"trigger_mode" varchar(20) DEFAULT 'round-trip' NOT NULL,
	"trigger_rate_limit" integer DEFAULT 5 NOT NULL,
	"profile_name" varchar(255),
	"profile_pic_url" text,
	"profile_bio" text,
	"profile_metadata" jsonb,
	"profile_synced_at" timestamp,
	"owner_identifier" varchar(255),
	"download_media_on_sync" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"enable_auto_split" boolean DEFAULT true NOT NULL,
	"message_format_mode" varchar(20) DEFAULT 'convert' NOT NULL,
	"disable_username_prefix" boolean DEFAULT false NOT NULL,
	"process_media_on_blocked" boolean DEFAULT true NOT NULL,
	"access_mode" varchar(20) DEFAULT 'blocklist' NOT NULL,
	"message_debounce_mode" varchar(20) DEFAULT 'disabled' NOT NULL,
	"message_debounce_min_ms" integer DEFAULT 0 NOT NULL,
	"message_debounce_group_ms" integer,
	"message_debounce_max_ms" integer DEFAULT 0 NOT NULL,
	"message_debounce_restart_on_typing" boolean DEFAULT false NOT NULL,
	"agent_gate_enabled" boolean DEFAULT false NOT NULL,
	"agent_gate_model" varchar(120),
	"agent_gate_prompt" text,
	"message_split_delay_mode" varchar(20) DEFAULT 'randomized' NOT NULL,
	"message_split_delay_fixed_ms" integer DEFAULT 0 NOT NULL,
	"message_split_delay_min_ms" integer DEFAULT 300 NOT NULL,
	"message_split_delay_max_ms" integer DEFAULT 1000 NOT NULL,
	"tts_voice_id" text,
	"tts_model_id" text,
	"process_audio" boolean DEFAULT true NOT NULL,
	"process_images" boolean DEFAULT true NOT NULL,
	"process_video" boolean DEFAULT true NOT NULL,
	"process_documents" boolean DEFAULT true NOT NULL,
	"agent_wait_for_media" boolean DEFAULT true NOT NULL,
	"agent_send_media_path" boolean DEFAULT true NOT NULL,
	"last_message_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "instances_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "media_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"media_id" uuid,
	"processing_type" varchar(20) NOT NULL,
	"content" text NOT NULL,
	"model" varchar(100),
	"provider" varchar(50),
	"language" varchar(10),
	"duration" integer,
	"tokens_used" integer,
	"cost_usd" integer,
	"batch_job_id" uuid,
	"processing_time_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"source" varchar(20) NOT NULL,
	"sender_person_id" uuid,
	"sender_platform_identity_id" uuid,
	"sender_platform_user_id" varchar(255),
	"sender_display_name" varchar(255),
	"is_from_me" boolean DEFAULT false NOT NULL,
	"message_type" varchar(50) NOT NULL,
	"text_content" text,
	"transcription" text,
	"image_description" text,
	"video_description" text,
	"document_extraction" text,
	"has_media" boolean DEFAULT false NOT NULL,
	"media_mime_type" varchar(100),
	"media_url" text,
	"media_local_path" text,
	"media_metadata" jsonb,
	"reply_to_message_id" uuid,
	"reply_to_external_id" varchar(255),
	"quoted_text" text,
	"quoted_sender_name" varchar(255),
	"forwarded_from_message_id" uuid,
	"forwarded_from_external_id" varchar(255),
	"forward_count" integer DEFAULT 0 NOT NULL,
	"is_forwarded" boolean DEFAULT false NOT NULL,
	"mentions" jsonb,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"delivery_status" varchar(20) DEFAULT 'sent',
	"edit_count" integer DEFAULT 0 NOT NULL,
	"original_text" text,
	"edit_history" jsonb,
	"edited_at" timestamp,
	"deleted_at" timestamp,
	"reactions" jsonb,
	"reaction_counts" jsonb,
	"raw_payload" jsonb,
	"original_event_id" uuid,
	"latest_event_id" uuid,
	"platform_timestamp" timestamp NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "omni_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" varchar(255),
	"channel" varchar(50) NOT NULL,
	"instance_id" uuid,
	"person_id" uuid,
	"platform_identity_id" uuid,
	"event_type" varchar(50) NOT NULL,
	"direction" varchar(10) DEFAULT 'inbound' NOT NULL,
	"content_type" varchar(20),
	"text_content" text,
	"transcription" text,
	"image_description" text,
	"document_extraction" text,
	"media_id" uuid,
	"media_mime_type" varchar(100),
	"media_size" integer,
	"media_duration" integer,
	"media_url" text,
	"reply_to_event_id" uuid,
	"reply_to_external_id" varchar(255),
	"chat_id" varchar(255),
	"canonical_chat_id" varchar(255),
	"status" varchar(20) DEFAULT 'received' NOT NULL,
	"error_message" text,
	"error_stage" varchar(50),
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"delivered_at" timestamp,
	"read_at" timestamp,
	"processing_time_ms" integer,
	"agent_latency_ms" integer,
	"total_latency_ms" integer,
	"raw_payload" jsonb,
	"agent_request" jsonb,
	"agent_response" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "omni_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"channel" varchar(50) NOT NULL,
	"name" varchar(255),
	"description" text,
	"icon_url" text,
	"member_count" integer,
	"owner_id" varchar(255),
	"created_by" varchar(255),
	"is_read_only" boolean DEFAULT false NOT NULL,
	"is_community" boolean DEFAULT false NOT NULL,
	"platform_metadata" jsonb,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payload_storage_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"store_webhook_raw" boolean DEFAULT true NOT NULL,
	"store_agent_request" boolean DEFAULT true NOT NULL,
	"store_agent_response" boolean DEFAULT true NOT NULL,
	"store_channel_send" boolean DEFAULT true NOT NULL,
	"store_error" boolean DEFAULT true NOT NULL,
	"retention_days" integer DEFAULT 14 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payload_storage_config_event_type_unique" UNIQUE("event_type")
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" varchar(255),
	"primary_phone" varchar(50),
	"primary_email" varchar(255),
	"avatar_url" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid,
	"channel" varchar(50) NOT NULL,
	"instance_id" uuid,
	"platform_user_id" varchar(255) NOT NULL,
	"platform_username" varchar(255),
	"profile_pic_url" text,
	"profile_data" jsonb,
	"message_count" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"linked_by" varchar(50),
	"confidence" integer DEFAULT 100 NOT NULL,
	"link_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_storage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plugin_id" varchar(100) NOT NULL,
	"key" varchar(500) NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setting_change_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"setting_id" uuid NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_by" varchar(255),
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"change_reason" text
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"channel" varchar(50) NOT NULL,
	"type" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"config" jsonb DEFAULT '{}' NOT NULL,
	"progress" jsonb DEFAULT '{}' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "trigger_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" varchar(255),
	"instance_id" uuid NOT NULL,
	"provider_id" uuid,
	"route_id" uuid,
	"event_type" varchar(100) NOT NULL,
	"event_id" varchar(255) NOT NULL,
	"trigger_type" varchar(50) NOT NULL,
	"channel_type" varchar(50),
	"chat_id" varchar(255) NOT NULL,
	"sender_id" varchar(255),
	"mode" varchar(20),
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"responded" boolean DEFAULT false NOT NULL,
	"duration_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"error" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"expected_headers" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_received_at" timestamp,
	"total_received" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_sources_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "access_rules" ADD CONSTRAINT "access_rules_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_rules" ADD CONSTRAINT "access_rules_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_routes" ADD CONSTRAINT "agent_routes_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_routes" ADD CONSTRAINT "agent_routes_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_routes" ADD CONSTRAINT "agent_routes_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_routes" ADD CONSTRAINT "agent_routes_agent_provider_id_agent_providers_id_fk" FOREIGN KEY ("agent_provider_id") REFERENCES "public"."agent_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_audit_logs" ADD CONSTRAINT "api_key_audit_logs_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_logs" ADD CONSTRAINT "automation_logs_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_jobs" ADD CONSTRAINT "batch_jobs_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_id_mappings" ADD CONSTRAINT "chat_id_mappings_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_platform_identity_id_platform_identities_id_fk" FOREIGN KEY ("platform_identity_id") REFERENCES "public"."platform_identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_agent_provider_id_agent_providers_id_fk" FOREIGN KEY ("agent_provider_id") REFERENCES "public"."agent_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_content" ADD CONSTRAINT "media_content_event_id_omni_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."omni_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_content" ADD CONSTRAINT "media_content_batch_job_id_batch_jobs_id_fk" FOREIGN KEY ("batch_job_id") REFERENCES "public"."batch_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_person_id_persons_id_fk" FOREIGN KEY ("sender_person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_platform_identity_id_platform_identities_id_fk" FOREIGN KEY ("sender_platform_identity_id") REFERENCES "public"."platform_identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "omni_events" ADD CONSTRAINT "omni_events_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "omni_events" ADD CONSTRAINT "omni_events_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "omni_events" ADD CONSTRAINT "omni_events_platform_identity_id_platform_identities_id_fk" FOREIGN KEY ("platform_identity_id") REFERENCES "public"."platform_identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "omni_groups" ADD CONSTRAINT "omni_groups_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_identities" ADD CONSTRAINT "platform_identities_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_identities" ADD CONSTRAINT "platform_identities_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_change_history" ADD CONSTRAINT "setting_change_history_setting_id_global_settings_id_fk" FOREIGN KEY ("setting_id") REFERENCES "public"."global_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_logs" ADD CONSTRAINT "trigger_logs_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_logs" ADD CONSTRAINT "trigger_logs_provider_id_agent_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."agent_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_logs" ADD CONSTRAINT "trigger_logs_route_id_agent_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."agent_routes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_rules_instance_idx" ON "access_rules" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "access_rules_phone_idx" ON "access_rules" USING btree ("phone_pattern");--> statement-breakpoint
CREATE INDEX "access_rules_type_idx" ON "access_rules" USING btree ("rule_type");--> statement-breakpoint
CREATE UNIQUE INDEX "access_rules_unique_idx" ON "access_rules" USING btree ("instance_id","phone_pattern","rule_type");--> statement-breakpoint
CREATE INDEX "agent_providers_name_idx" ON "agent_providers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "agent_providers_schema_idx" ON "agent_providers" USING btree ("schema");--> statement-breakpoint
CREATE INDEX "agent_providers_active_idx" ON "agent_providers" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_routes_unique_chat_route" ON "agent_routes" USING btree ("instance_id","chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_routes_unique_user_route" ON "agent_routes" USING btree ("instance_id","person_id");--> statement-breakpoint
CREATE INDEX "agent_routes_instance_idx" ON "agent_routes" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "agent_routes_chat_idx" ON "agent_routes" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "agent_routes_person_idx" ON "agent_routes" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "agent_routes_active_idx" ON "agent_routes" USING btree ("instance_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_sessions_instance_key_idx" ON "agent_sessions" USING btree ("instance_id","session_key");--> statement-breakpoint
CREATE INDEX "agent_sessions_expires_idx" ON "agent_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "agent_sessions_last_used_idx" ON "agent_sessions" USING btree ("last_used_at");--> statement-breakpoint
CREATE INDEX "api_key_audit_logs_api_key_idx" ON "api_key_audit_logs" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "api_key_audit_logs_timestamp_idx" ON "api_key_audit_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "api_key_audit_logs_path_idx" ON "api_key_audit_logs" USING btree ("path");--> statement-breakpoint
CREATE INDEX "api_keys_key_prefix_idx" ON "api_keys" USING btree ("key_prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_status_idx" ON "api_keys" USING btree ("status");--> statement-breakpoint
CREATE INDEX "api_keys_expires_at_idx" ON "api_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "automation_logs_automation_idx" ON "automation_logs" USING btree ("automation_id");--> statement-breakpoint
CREATE INDEX "automation_logs_event_id_idx" ON "automation_logs" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "automation_logs_status_idx" ON "automation_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "automation_logs_created_at_idx" ON "automation_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "automations_name_idx" ON "automations" USING btree ("name");--> statement-breakpoint
CREATE INDEX "automations_trigger_idx" ON "automations" USING btree ("trigger_event_type");--> statement-breakpoint
CREATE INDEX "automations_enabled_idx" ON "automations" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "automations_priority_idx" ON "automations" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "batch_jobs_status_idx" ON "batch_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "batch_jobs_instance_idx" ON "batch_jobs" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "batch_jobs_created_at_idx" ON "batch_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_id_mappings_instance_lid_idx" ON "chat_id_mappings" USING btree ("instance_id","lid_id");--> statement-breakpoint
CREATE INDEX "chat_id_mappings_instance_phone_idx" ON "chat_id_mappings" USING btree ("instance_id","phone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_participants_chat_user_idx" ON "chat_participants" USING btree ("chat_id","platform_user_id");--> statement-breakpoint
CREATE INDEX "chat_participants_chat_idx" ON "chat_participants" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "chat_participants_person_idx" ON "chat_participants" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "chat_participants_platform_identity_idx" ON "chat_participants" USING btree ("platform_identity_id");--> statement-breakpoint
CREATE INDEX "chat_participants_role_idx" ON "chat_participants" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "chats_instance_external_idx" ON "chats" USING btree ("instance_id","external_id");--> statement-breakpoint
CREATE INDEX "chats_canonical_id_idx" ON "chats" USING btree ("canonical_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chats_instance_canonical_unique_idx" ON "chats" USING btree ("instance_id","canonical_id") WHERE "chats"."canonical_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "chats_type_idx" ON "chats" USING btree ("chat_type");--> statement-breakpoint
CREATE INDEX "chats_channel_idx" ON "chats" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "chats_parent_idx" ON "chats" USING btree ("parent_chat_id");--> statement-breakpoint
CREATE INDEX "chats_last_message_idx" ON "chats" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "dead_letter_events_event_id_idx" ON "dead_letter_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "dead_letter_events_event_type_idx" ON "dead_letter_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "dead_letter_events_status_idx" ON "dead_letter_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dead_letter_events_created_at_idx" ON "dead_letter_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "dead_letter_events_next_retry_idx" ON "dead_letter_events" USING btree ("next_auto_retry_at");--> statement-breakpoint
CREATE INDEX "event_payloads_event_id_idx" ON "event_payloads" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_payloads_event_type_idx" ON "event_payloads" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "event_payloads_stage_idx" ON "event_payloads" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "event_payloads_timestamp_idx" ON "event_payloads" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "event_payloads_deleted_at_idx" ON "event_payloads" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "event_payloads_event_stage_idx" ON "event_payloads" USING btree ("event_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "global_settings_key_idx" ON "global_settings" USING btree ("key");--> statement-breakpoint
CREATE INDEX "global_settings_category_idx" ON "global_settings" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "instances_name_idx" ON "instances" USING btree ("name");--> statement-breakpoint
CREATE INDEX "instances_channel_idx" ON "instances" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "instances_is_active_idx" ON "instances" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "instances_is_default_idx" ON "instances" USING btree ("is_default");--> statement-breakpoint
CREATE INDEX "media_content_event_idx" ON "media_content" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "media_content_media_idx" ON "media_content" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "media_content_batch_job_idx" ON "media_content" USING btree ("batch_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_chat_external_idx" ON "messages" USING btree ("chat_id","external_id");--> statement-breakpoint
CREATE INDEX "messages_chat_idx" ON "messages" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "messages_sender_person_idx" ON "messages" USING btree ("sender_person_id");--> statement-breakpoint
CREATE INDEX "messages_sender_platform_identity_idx" ON "messages" USING btree ("sender_platform_identity_id");--> statement-breakpoint
CREATE INDEX "messages_source_idx" ON "messages" USING btree ("source");--> statement-breakpoint
CREATE INDEX "messages_type_idx" ON "messages" USING btree ("message_type");--> statement-breakpoint
CREATE INDEX "messages_status_idx" ON "messages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "messages_platform_timestamp_idx" ON "messages" USING btree ("platform_timestamp");--> statement-breakpoint
CREATE INDEX "messages_reply_to_idx" ON "messages" USING btree ("reply_to_message_id");--> statement-breakpoint
CREATE INDEX "messages_has_media_idx" ON "messages" USING btree ("has_media");--> statement-breakpoint
CREATE INDEX "messages_original_event_idx" ON "messages" USING btree ("original_event_id");--> statement-breakpoint
CREATE INDEX "omni_events_external_id_idx" ON "omni_events" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "omni_events_channel_idx" ON "omni_events" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "omni_events_instance_idx" ON "omni_events" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "omni_events_person_idx" ON "omni_events" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "omni_events_type_idx" ON "omni_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "omni_events_status_idx" ON "omni_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "omni_events_received_at_idx" ON "omni_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "omni_events_chat_id_idx" ON "omni_events" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "omni_events_canonical_chat_idx" ON "omni_events" USING btree ("canonical_chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "omni_groups_instance_external_idx" ON "omni_groups" USING btree ("instance_id","external_id");--> statement-breakpoint
CREATE INDEX "omni_groups_instance_idx" ON "omni_groups" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "omni_groups_channel_idx" ON "omni_groups" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "omni_groups_name_idx" ON "omni_groups" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "payload_storage_config_event_type_idx" ON "payload_storage_config" USING btree ("event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "persons_phone_idx" ON "persons" USING btree ("primary_phone");--> statement-breakpoint
CREATE INDEX "persons_email_idx" ON "persons" USING btree ("primary_email");--> statement-breakpoint
CREATE INDEX "persons_name_idx" ON "persons" USING btree ("display_name");--> statement-breakpoint
CREATE INDEX "platform_identities_person_idx" ON "platform_identities" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "platform_identities_channel_idx" ON "platform_identities" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "platform_identities_instance_idx" ON "platform_identities" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "platform_identities_platform_user_idx" ON "platform_identities" USING btree ("platform_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_identities_channel_user_idx" ON "platform_identities" USING btree ("channel","instance_id","platform_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_storage_plugin_key_idx" ON "plugin_storage" USING btree ("plugin_id","key");--> statement-breakpoint
CREATE INDEX "plugin_storage_plugin_idx" ON "plugin_storage" USING btree ("plugin_id");--> statement-breakpoint
CREATE INDEX "plugin_storage_expires_at_idx" ON "plugin_storage" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "setting_change_history_setting_idx" ON "setting_change_history" USING btree ("setting_id");--> statement-breakpoint
CREATE INDEX "setting_change_history_changed_at_idx" ON "setting_change_history" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX "sync_jobs_instance_idx" ON "sync_jobs" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "sync_jobs_status_idx" ON "sync_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sync_jobs_type_idx" ON "sync_jobs" USING btree ("type");--> statement-breakpoint
CREATE INDEX "sync_jobs_created_at_idx" ON "sync_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "trigger_logs_instance_idx" ON "trigger_logs" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "trigger_logs_trace_idx" ON "trigger_logs" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "trigger_logs_fired_at_idx" ON "trigger_logs" USING btree ("fired_at");--> statement-breakpoint
CREATE INDEX "trigger_logs_event_type_idx" ON "trigger_logs" USING btree ("event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_sources_name_idx" ON "webhook_sources" USING btree ("name");--> statement-breakpoint
CREATE INDEX "webhook_sources_enabled_idx" ON "webhook_sources" USING btree ("enabled");