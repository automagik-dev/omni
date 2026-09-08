-- Manifest-compilation provenance on automations (#986, RFC #925 G4b).
--
-- Adds `automations.managed_by_agent_id`: set when the row was COMPILED from
-- `agents.event_manifest` by the manifest compiler
-- (packages/api/src/services/manifest-compiler.ts); NULL = hand-made. The
-- agent's manifest is the source of truth and `automations` becomes the
-- compiled plan for these rows — the API rejects manual create/update/delete
-- of a managed automation so the plan cannot drift silently.
--
-- The FK is ON DELETE CASCADE so a hard agent delete removes its compiled
-- plan at the DB level (the service-level soft delete reconciles compiled
-- rows away explicitly before that ever matters). NOT VALID mirrors the 0041
-- precedent: no scan on deploy; every new write is checked.
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).
--
-- NOTE: no explicit BEGIN/COMMIT — the boot migrator executes this file on a
-- pooled postgres-js connection, which rejects raw transaction control.

ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "managed_by_agent_id" uuid;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'automations_managed_by_agent_fk' AND conrelid = '"automations"'::regclass
    ) THEN
        ALTER TABLE "automations" ADD CONSTRAINT "automations_managed_by_agent_fk" FOREIGN KEY ("managed_by_agent_id") REFERENCES "agents" ("id") ON DELETE CASCADE NOT VALID;
    END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automations_managed_by_agent_idx" ON "automations" ("managed_by_agent_id");
