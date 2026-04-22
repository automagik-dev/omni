-- Idempotency ledger for durable NATS subscribers (#411).
--
-- Background: durable consumers re-deliver messages on PM2 restart / SIGKILL
-- when the handler hadn't ACKed before death (ack_wait = 30s). Handlers with
-- non-idempotent side-effects (send WhatsApp message, delete Agno session,
-- dispatch agent turn) re-fired the side-effect, leading to customer-visible
-- duplicates (issue #411 — Gustavo received "✅ Conversa limpa!" up to 5x).
--
-- The (event_id, handler) row is claimed BEFORE the side-effect runs.
-- On replay the claim hits the PK constraint and the side-effect is skipped.
-- Composite key lets multiple handlers (session-cleaner, agent-dispatcher,
-- agent-responder) independently mark the same event id.

CREATE TABLE IF NOT EXISTS "processed_events" (
  "event_id" varchar(255) NOT NULL,
  "handler" varchar(100) NOT NULL,
  "processed_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "processed_events_pk" PRIMARY KEY("event_id", "handler")
);

CREATE INDEX IF NOT EXISTS "processed_events_processed_at_idx"
  ON "processed_events" USING btree ("processed_at");
