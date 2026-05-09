-- Migration 0036: Convert all TZ-naive timestamps to timestamptz
-- 
-- ROOT CAUSE: timestamp without time zone strips offset on write.
-- PG NOW() in session TZ + JS new Date() in UTC produced literal wall-clock
-- values 3h apart on canonical pgserve (America/Sao_Paulo).
-- Symptom: turn-monitor read closed_at - started_at = 10800s and force-closed
-- every fresh turn before the agent could respond.
--
-- USING strategy per column:
--   defaultNow() columns -> wall-clock is in current session TZ -> AT TIME ZONE current_setting('TimeZone')
--   nullable columns set by JS -> wall-clock is UTC -> AT TIME ZONE 'UTC'

BEGIN;

-- Table: access_rules
ALTER TABLE "access_rules" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "access_rules" ALTER COLUMN "expires_at" TYPE timestamptz USING "expires_at" AT TIME ZONE 'UTC';
ALTER TABLE "access_rules" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE current_setting('TimeZone');
-- Table: agent_providers
ALTER TABLE "agent_providers" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "agent_providers" ALTER COLUMN "last_health_check" TYPE timestamptz USING "last_health_check" AT TIME ZONE 'UTC';
ALTER TABLE "agent_providers" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE current_setting('TimeZone');
-- Table: agent_routes
ALTER TABLE "agent_routes" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "agent_routes" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE current_setting('TimeZone');
-- Table: agent_sessions
ALTER TABLE "agent_sessions" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "agent_sessions" ALTER COLUMN "expires_at" TYPE timestamptz USING "expires_at" AT TIME ZONE 'UTC';
ALTER TABLE "agent_sessions" ALTER COLUMN "last_used_at" TYPE timestamptz USING "last_used_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "agent_sessions" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE current_setting('TimeZone');
-- Table: agent_tasks
ALTER TABLE "agent_tasks" ALTER COLUMN "completed_at" TYPE timestamptz USING "completed_at" AT TIME ZONE 'UTC';
ALTER TABLE "agent_tasks" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "agent_tasks" ALTER COLUMN "started_at" TYPE timestamptz USING "started_at" AT TIME ZONE 'UTC';
-- Table: agents
ALTER TABLE "agents" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "agents" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE current_setting('TimeZone');
-- Table: api_key_audit_logs
ALTER TABLE "api_key_audit_logs" ALTER COLUMN "timestamp" TYPE timestamptz USING "timestamp" AT TIME ZONE current_setting('TimeZone');
-- Table: api_keys
ALTER TABLE "api_keys" ALTER COLUMN "context_updated_at" TYPE timestamptz USING "context_updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "api_keys" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "api_keys" ALTER COLUMN "expires_at" TYPE timestamptz USING "expires_at" AT TIME ZONE 'UTC';
ALTER TABLE "api_keys" ALTER COLUMN "last_used_at" TYPE timestamptz USING "last_used_at" AT TIME ZONE 'UTC';
ALTER TABLE "api_keys" ALTER COLUMN "revoked_at" TYPE timestamptz USING "revoked_at" AT TIME ZONE 'UTC';
ALTER TABLE "api_keys" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE current_setting('TimeZone');
-- Table: automation_logs
ALTER TABLE "automation_logs" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
-- Table: automations
ALTER TABLE "automations" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "automations" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE current_setting('TimeZone');
-- Table: batch_jobs
ALTER TABLE "batch_jobs" ALTER COLUMN "completed_at" TYPE timestamptz USING "completed_at" AT TIME ZONE 'UTC';
ALTER TABLE "batch_jobs" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "batch_jobs" ALTER COLUMN "started_at" TYPE timestamptz USING "started_at" AT TIME ZONE 'UTC';
-- Table: chat_id_mappings
ALTER TABLE "chat_id_mappings" ALTER COLUMN "discovered_at" TYPE timestamptz USING "discovered_at" AT TIME ZONE current_setting('TimeZone');
-- Table: chat_participants
ALTER TABLE "chat_participants" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "chat_participants" ALTER COLUMN "joined_at" TYPE timestamptz USING "joined_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "chat_participants" ALTER COLUMN "last_seen_at" TYPE timestamptz USING "last_seen_at" AT TIME ZONE 'UTC';
ALTER TABLE "chat_participants" ALTER COLUMN "left_at" TYPE timestamptz USING "left_at" AT TIME ZONE 'UTC';
ALTER TABLE "chat_participants" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE current_setting('TimeZone');
-- Table: chats
ALTER TABLE "chats" ALTER COLUMN "archived_at" TYPE timestamptz USING "archived_at" AT TIME ZONE 'UTC';
ALTER TABLE "chats" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "chats" ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';
ALTER TABLE "chats" ALTER COLUMN "last_message_at" TYPE timestamptz USING "last_message_at" AT TIME ZONE 'UTC';
ALTER TABLE "chats" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE current_setting('TimeZone');
-- Table: consumer_offsets
ALTER TABLE "consumer_offsets" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE current_setting('TimeZone');
-- Table: conversations
ALTER TABLE "conversations" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "conversations" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE current_setting('TimeZone');
-- Table: dead_letter_events
ALTER TABLE "dead_letter_events" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "dead_letter_events" ALTER COLUMN "last_retry_at" TYPE timestamptz USING "last_retry_at" AT TIME ZONE 'UTC';
ALTER TABLE "dead_letter_events" ALTER COLUMN "next_auto_retry_at" TYPE timestamptz USING "next_auto_retry_at" AT TIME ZONE 'UTC';
ALTER TABLE "dead_letter_events" ALTER COLUMN "resolved_at" TYPE timestamptz USING "resolved_at" AT TIME ZONE 'UTC';
-- Table: event_payloads
ALTER TABLE "event_payloads" ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';
ALTER TABLE "event_payloads" ALTER COLUMN "timestamp" TYPE timestamptz USING "timestamp" AT TIME ZONE current_setting('TimeZone');
-- Table: genie_hosts
ALTER TABLE "genie_hosts" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "genie_hosts" ALTER COLUMN "last_seen_at" TYPE timestamptz USING "last_seen_at" AT TIME ZONE 'UTC';
ALTER TABLE "genie_hosts" ALTER COLUMN "revoked_at" TYPE timestamptz USING "revoked_at" AT TIME ZONE 'UTC';
ALTER TABLE "genie_hosts" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE current_setting('TimeZone');
-- Table: global_settings
ALTER TABLE "global_settings" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "global_settings" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE current_setting('TimeZone');
-- Table: handoff_logs
ALTER TABLE "handoff_logs" ALTER COLUMN "sent_at" TYPE timestamptz USING "sent_at" AT TIME ZONE current_setting('TimeZone');
-- Table: instances
ALTER TABLE "instances" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "instances" ALTER COLUMN "last_message_at" TYPE timestamptz USING "last_message_at" AT TIME ZONE 'UTC';
ALTER TABLE "instances" ALTER COLUMN "last_seen_at" TYPE timestamptz USING "last_seen_at" AT TIME ZONE 'UTC';
ALTER TABLE "instances" ALTER COLUMN "profile_synced_at" TYPE timestamptz USING "profile_synced_at" AT TIME ZONE 'UTC';
ALTER TABLE "instances" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE current_setting('TimeZone');
-- Table: media_content
ALTER TABLE "media_content" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
-- Table: messages
ALTER TABLE "messages" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "messages" ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';
ALTER TABLE "messages" ALTER COLUMN "edited_at" TYPE timestamptz USING "edited_at" AT TIME ZONE 'UTC';
ALTER TABLE "messages" ALTER COLUMN "platform_timestamp" TYPE timestamptz USING "platform_timestamp" AT TIME ZONE 'UTC';
ALTER TABLE "messages" ALTER COLUMN "received_at" TYPE timestamptz USING "received_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "messages" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE current_setting('TimeZone');
-- Table: omni_events
ALTER TABLE "omni_events" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "omni_events" ALTER COLUMN "delivered_at" TYPE timestamptz USING "delivered_at" AT TIME ZONE 'UTC';
ALTER TABLE "omni_events" ALTER COLUMN "processed_at" TYPE timestamptz USING "processed_at" AT TIME ZONE 'UTC';
ALTER TABLE "omni_events" ALTER COLUMN "read_at" TYPE timestamptz USING "read_at" AT TIME ZONE 'UTC';
ALTER TABLE "omni_events" ALTER COLUMN "received_at" TYPE timestamptz USING "received_at" AT TIME ZONE current_setting('TimeZone');
-- Table: omni_groups
ALTER TABLE "omni_groups" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "omni_groups" ALTER COLUMN "synced_at" TYPE timestamptz USING "synced_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "omni_groups" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE current_setting('TimeZone');
-- Table: payload_storage_config
ALTER TABLE "payload_storage_config" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "payload_storage_config" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE current_setting('TimeZone');
-- Table: persons
ALTER TABLE "persons" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "persons" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE current_setting('TimeZone');
-- Table: platform_identities
ALTER TABLE "platform_identities" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "platform_identities" ALTER COLUMN "first_seen_at" TYPE timestamptz USING "first_seen_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "platform_identities" ALTER COLUMN "last_seen_at" TYPE timestamptz USING "last_seen_at" AT TIME ZONE 'UTC';
ALTER TABLE "platform_identities" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE current_setting('TimeZone');
-- Table: plugin_storage
ALTER TABLE "plugin_storage" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "plugin_storage" ALTER COLUMN "expires_at" TYPE timestamptz USING "expires_at" AT TIME ZONE 'UTC';
ALTER TABLE "plugin_storage" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE current_setting('TimeZone');
-- Table: processed_events
ALTER TABLE "processed_events" ALTER COLUMN "processed_at" TYPE timestamptz USING "processed_at" AT TIME ZONE current_setting('TimeZone');
-- Table: setting_change_history
ALTER TABLE "setting_change_history" ALTER COLUMN "changed_at" TYPE timestamptz USING "changed_at" AT TIME ZONE current_setting('TimeZone');
-- Table: sync_jobs
ALTER TABLE "sync_jobs" ALTER COLUMN "completed_at" TYPE timestamptz USING "completed_at" AT TIME ZONE 'UTC';
ALTER TABLE "sync_jobs" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "sync_jobs" ALTER COLUMN "started_at" TYPE timestamptz USING "started_at" AT TIME ZONE 'UTC';
-- Table: turns
ALTER TABLE "turns" ALTER COLUMN "closed_at" TYPE timestamptz USING "closed_at" AT TIME ZONE 'UTC';
ALTER TABLE "turns" ALTER COLUMN "last_activity_at" TYPE timestamptz USING "last_activity_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "turns" ALTER COLUMN "started_at" TYPE timestamptz USING "started_at" AT TIME ZONE current_setting('TimeZone');
-- Table: webhook_sources
ALTER TABLE "webhook_sources" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE current_setting('TimeZone');
ALTER TABLE "webhook_sources" ALTER COLUMN "last_received_at" TYPE timestamptz USING "last_received_at" AT TIME ZONE 'UTC';
ALTER TABLE "webhook_sources" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE current_setting('TimeZone');

COMMIT;
