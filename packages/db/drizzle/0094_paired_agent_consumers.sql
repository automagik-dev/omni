-- Paired-agents slice 2: provenance, agent-owned consumers and source grants.
-- Wish: paired-agents-slice-2; DESIGN row 5, R13-3 (no grant writer in this slice).
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
-- Large-journal prerequisite: run online preparation from the exact candidate
-- checkout before upgrading, per docs/deployment/paired-agent-journal-indexes.md.
-- The estimate-based boot preflight backs up this operator-held prerequisite.

ALTER TABLE "omni_events" ADD COLUMN IF NOT EXISTS "producing_key_id" uuid;
ALTER TABLE "omni_events" ADD COLUMN IF NOT EXISTS "source_kind" varchar(32);
ALTER TABLE "omni_events" ADD COLUMN IF NOT EXISTS "source_id" uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'omni_events_source_ref_ck' AND conrelid = 'omni_events'::regclass) THEN
    ALTER TABLE "omni_events" ADD CONSTRAINT "omni_events_source_ref_ck"
      CHECK ((source_kind IS NULL) = (source_id IS NULL)
        AND (source_kind IS NULL OR source_kind IN ('connector','connector_subscription','webhook_source')))
      NOT VALID;
  END IF;
END $$;

-- No FK: deleting an agent must never turn its consumer into an unowned one.
ALTER TABLE "durable_consumers" ADD COLUMN IF NOT EXISTS "agent_id" uuid;

CREATE TABLE IF NOT EXISTS "agent_source_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "source_kind" varchar(32) NOT NULL,
  "source_id" uuid NOT NULL,
  "approved_by_key_id" uuid NOT NULL,
  "approved_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_at" timestamptz,
  "tenant_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "agent_source_grants_kind_ck"
    CHECK (source_kind IN ('connector','connector_subscription','webhook_source','agent'))
);

CREATE INDEX IF NOT EXISTS "omni_events_instance_type_seq_idx" ON "omni_events" ("instance_id", "event_type", "journal_seq") WHERE "instance_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "omni_events_source_type_seq_idx" ON "omni_events" ("source_kind", "source_id", "event_type", "journal_seq") WHERE "source_kind" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "omni_events_agent_type_seq_idx" ON "omni_events" ("agent_id", "event_type", "journal_seq") WHERE "agent_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "omni_events_producing_key_idx" ON "omni_events" ("producing_key_id") WHERE "producing_key_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "durable_consumers_agent_idx" ON "durable_consumers" ("agent_id") WHERE "agent_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "agent_source_grants_active_uq" ON "agent_source_grants" ("agent_id", "source_kind", "source_id") WHERE "revoked_at" IS NULL;
