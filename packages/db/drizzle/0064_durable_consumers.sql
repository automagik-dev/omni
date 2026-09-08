-- Durable named event consumers (#989, RFC #925 G7 — the durable half of the
-- event-consumer surface; the one-shot half, `omni events wait`, shipped in
-- PR #972).
--
-- omni_events.journal_seq: a monotonic journal position assigned by a
-- sequence at insert. The durable-consumer cursor is "last acked journal_seq"
-- and delivery resumes strictly after it. receivedAt cannot anchor an
-- at-least-once cursor — it carries the PUBLISHER's clock and lands out of
-- order under consumer retries. BIGSERIAL backfills existing rows (physical
-- order; they predate every consumer, so the order among them is moot).
--
-- durable_consumers: the registry — name (globally unique), event-type filter
-- (trailing-* prefix glob, the #966 contract), optional payload conditions
-- (same matcher as `events wait --filter` / automation triggers), and the
-- cursor. NOT consumer_offsets: that table is owned by the NATS subscription
-- layer (gap detection over NATS stream sequences); this registry has an
-- API-managed lifecycle and a different sequence space (the journal IS the
-- replay source, NATS is transport).
--
-- TENANCY: global — no tenant_id column, following the event_schemas
-- precedent (0056): the RLS coverage gate requires every tenant_id-bearing
-- table to be in the frozen G0 manifest, the G1 tenant plane, or the
-- runtime-denied exclusions. Event reads stay tenant-policed through
-- omni_events' own RLS; per-tenant consumer ownership joins additively in
-- the G6+ ownership pass.
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
--
-- NOTE: no explicit BEGIN/COMMIT — the boot migrator executes this file on a
-- pooled postgres-js connection, which rejects raw transaction control.

ALTER TABLE "omni_events" ADD COLUMN IF NOT EXISTS "journal_seq" bigserial;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "omni_events_journal_seq_uq" ON "omni_events" ("journal_seq");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "durable_consumers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(100) NOT NULL,
  "event_type" varchar(255) NOT NULL,
  "filters" jsonb,
  "cursor" bigint DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "durable_consumers_name_uq" ON "durable_consumers" ("name");
