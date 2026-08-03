-- Channel id rename: whatsapp-cloud → whatsapp-business.
--
-- 'Cloud API' named a distinction against Meta's On-Premises API (retired
-- Oct/2025); the channel is now identified as whatsapp-business ("WhatsApp
-- Business API (Meta)"). Channel columns are plain varchar(50) with no pg
-- enum or CHECK constraint, so the rename is a set of idempotent UPDATEs
-- over every column that stores the channel id string.
--
-- DELIBERATELY NOT rewritten: jsonb payloads on omni_events
-- (raw_payload/agent_request/agent_response/metadata). Historical events are
-- an immutable record — payloads created before this migration keep
-- channelType 'whatsapp-cloud'; consumers querying historical jsonb by
-- channel must match both values. The typed `channel` COLUMN on omni_events
-- IS updated (it is an index/filter column, not a record of what was sent).
--
-- Hand-written following the 0044-0046 precedent (snapshot drift keeps
-- drizzle-kit generate interactive). Additive + idempotent statements.

-- NOTE: no explicit BEGIN/COMMIT — the boot migrator executes this file on a
-- pooled postgres-js connection, which rejects raw transaction control
-- (UNSAFE_TRANSACTION).

UPDATE "instances" SET "channel" = 'whatsapp-business' WHERE "channel" = 'whatsapp-cloud';

UPDATE "platform_identities" SET "channel" = 'whatsapp-business' WHERE "channel" = 'whatsapp-cloud';

UPDATE "chats" SET "channel" = 'whatsapp-business' WHERE "channel" = 'whatsapp-cloud';

UPDATE "omni_groups" SET "channel" = 'whatsapp-business' WHERE "channel" = 'whatsapp-cloud';

UPDATE "omni_events" SET "channel" = 'whatsapp-business' WHERE "channel" = 'whatsapp-cloud';

UPDATE "sync_jobs" SET "channel" = 'whatsapp-business' WHERE "channel" = 'whatsapp-cloud';

UPDATE "trigger_logs" SET "channel_type" = 'whatsapp-business' WHERE "channel_type" = 'whatsapp-cloud';
