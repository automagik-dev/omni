-- Message threading + permalink (#889).
--
-- Until now the omni core had no representation of a thread. `threadId` rode
-- along in the event payload (packages/core/src/events/types.ts) purely to
-- route per_thread agent sessions, and was dropped on the floor at
-- persistence time. The one modelled path — chats.parent_chat_id +
-- chat_type='thread' — is dead code: inferChatType() only inspects WhatsApp
-- JID suffixes and never returns 'thread'.
--
-- The practical damage: channel-slack sends `replyToId = thread_ts`, so a
-- Slack thread reply is indistinguishable from a WhatsApp quote once stored.
--
-- A reply points at ONE message. A thread is a sub-conversation many people
-- post into. They are different relations and need different columns.
--
-- `is_thread_broadcast` carries Slack's `reply_broadcast` — posted inside the
-- thread AND surfaced in the channel. It is orthogonal to thread_external_id,
-- hence its own column rather than an enum on one field.
--
-- `reply_count` / `latest_reply_at` are denormalized onto the ROOT message.
--
-- No backfill: thread membership was never recorded, so it cannot be
-- reconstructed from existing rows. Historical Slack thread replies keep
-- reply_to_external_id set and simply carry NULL thread_external_id.
--
-- Hand-written following the 0044-0047 precedent (snapshot drift keeps
-- drizzle-kit generate interactive). Additive + idempotent.

-- NOTE: no explicit BEGIN/COMMIT — the boot migrator executes this file on a
-- pooled postgres-js connection, which rejects raw transaction control
-- (UNSAFE_TRANSACTION).

ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "thread_external_id" varchar(255);
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "thread_root_message_id" uuid;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "is_thread_broadcast" boolean DEFAULT false NOT NULL;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "reply_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "latest_reply_at" timestamp with time zone;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "permalink" text;

-- Fetch a whole thread in platform order.
CREATE INDEX IF NOT EXISTS "messages_thread_external_idx"
  ON "messages" ("chat_id", "thread_external_id", "platform_timestamp");

CREATE INDEX IF NOT EXISTS "messages_thread_root_idx"
  ON "messages" ("thread_root_message_id");
