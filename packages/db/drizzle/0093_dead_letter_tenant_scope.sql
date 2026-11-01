-- Dead-letter ownership and enforced-RLS retries (#1467).
-- Derive ownership from the authenticated transaction, or a persisted source
-- event for off-request writers. Never accept NEW.tenant_id or payload claims.
-- Existing NULL rows remain unowned and hidden under enforcement. Their
-- ownership repair belongs to the G6 tenancy backfill, not this migration.
-- no-schema-change: replaces the frozen 0041 ownership trigger body only.
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).

CREATE OR REPLACE FUNCTION "omni_tenant_ownership_dead_letter_events"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_scope uuid := nullif(current_setting('app.tenant_id', true), '')::uuid;
BEGIN
    NEW."tenant_id" := v_scope;
    IF v_scope IS NULL THEN
        SELECT e."tenant_id" INTO NEW."tenant_id"
        FROM "omni_events" e
        WHERE e."id" = CASE
            WHEN NEW."event_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN NEW."event_id"::uuid
            ELSE NULL
        END;
    END IF;
    RETURN NEW;
END;
$$;
