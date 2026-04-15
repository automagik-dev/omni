-- Add `inbound_max_age_minutes` to `instances`. Drops inbound
-- `message.received` events for the agent dispatcher when the platform-native
-- timestamp (e.g. WhatsApp `messageTimestamp`) is older than this value.
--
-- Guards against history-sync replays and NATS redelivery of stale messages
-- after reconnect/restart. Default: 10 minutes.

ALTER TABLE "instances" ADD COLUMN "inbound_max_age_minutes" integer DEFAULT 10 NOT NULL;
