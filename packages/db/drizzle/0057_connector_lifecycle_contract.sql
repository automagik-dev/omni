-- Connector lifecycle contract (#961) — liveness, heartbeat, declared
-- window/mutation semantics on webhook_sources.
--
-- A source that declares expected_interval_seconds promises "≥1 event or
-- heartbeat per N seconds". The liveness sweeper compares the most recent
-- signal — GREATEST(last_received_at, last_heartbeat_at, liveness_armed_at) —
-- against that window and owns every liveness_status transition, so
-- system.connector.stalled / system.connector.recovered are emitted exactly
-- once per transition.
--
--   expected_interval_seconds  integer      declared cadence; NULL = unsupervised
--   last_heartbeat_at          timestamptz  "I ran, zero events found" — the
--                                           heartbeat verb's compacted trace
--                                           (no journal event per heartbeat)
--   heartbeat_count            integer      total heartbeats received
--   liveness_status            varchar(20)  'healthy' | 'stalled'; NULL = unsupervised
--   liveness_armed_at          timestamptz  when the cadence was (re)declared —
--                                           a fresh window before a stall can fire
--   stalled_at                 timestamptz  when the current stall began
--   window_semantics           varchar(40)  'future_only' | 'includes_in_progress'
--   mutation_policy            varchar(20)  'same_id' | 'new_id' (feeds #958's
--                                           idempotency key template choice)
--
-- Hand-written following the 0044-0055 precedent (snapshot drift keeps
-- drizzle-kit generate interactive). Additive + idempotent. No explicit
-- BEGIN/COMMIT — the boot migrator executes this file on a pooled postgres-js
-- connection, which rejects raw transaction control.

ALTER TABLE "webhook_sources" ADD COLUMN IF NOT EXISTS "expected_interval_seconds" integer;
ALTER TABLE "webhook_sources" ADD COLUMN IF NOT EXISTS "last_heartbeat_at" timestamp with time zone;
ALTER TABLE "webhook_sources" ADD COLUMN IF NOT EXISTS "heartbeat_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "webhook_sources" ADD COLUMN IF NOT EXISTS "liveness_status" varchar(20);
ALTER TABLE "webhook_sources" ADD COLUMN IF NOT EXISTS "liveness_armed_at" timestamp with time zone;
ALTER TABLE "webhook_sources" ADD COLUMN IF NOT EXISTS "stalled_at" timestamp with time zone;
ALTER TABLE "webhook_sources" ADD COLUMN IF NOT EXISTS "window_semantics" varchar(40);
ALTER TABLE "webhook_sources" ADD COLUMN IF NOT EXISTS "mutation_policy" varchar(20);

-- The liveness sweeper's scan: enabled sources with a declared cadence.
CREATE INDEX IF NOT EXISTS "webhook_sources_supervised_idx"
  ON "webhook_sources" ("enabled") WHERE "expected_interval_seconds" IS NOT NULL;
