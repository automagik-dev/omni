-- Connector event ownership (wish: connectors-first-slice-clickup, finding F3).
--
-- `omni_events` owns its tenant through its instance/person/chat/agent/
-- conversation parents. A connector delivery has none of those by design, so
-- the G2 trigger leaves its `tenant_id` NULL -- and under FORCE RLS the
-- INSERT policy rejects it. That makes the public ingress inert the moment
-- enforcement is on.
--
-- This migration is the narrow derivation the delivery needs: when the event
-- is a connector event and names a subscription in metadata, the tenant is
-- copied from that PERSISTED subscription row. It is not a caller claim; a
-- foreign or malformed subscription id derives nothing, and the existing RLS
-- WITH CHECK remains the authority that rejects the insert.
--
-- no-schema-change: only the frozen 0041 trigger function's body is replaced;
-- no column, table or index changes, and the 0041 file itself stays untouched.
--
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).

CREATE OR REPLACE FUNCTION "omni_tenant_ownership_omni_events"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent uuid;
    v_resolved uuid := NULL;
    v_seen boolean := false;
    v_null_parent boolean := false;
BEGIN
    -- Tenant identity is derived, never accepted from the caller.
    NEW."tenant_id" := NULL;

    IF NEW."instance_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "instances" p WHERE p."id" = NEW."instance_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."instance_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."person_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "persons" p WHERE p."id" = NEW."person_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."person_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."platform_identity_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "platform_identities" p WHERE p."id" = NEW."platform_identity_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."platform_identity_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."chat_uuid" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "chats" p WHERE p."id" = NEW."chat_uuid";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."chat_uuid": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."agent_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "agents" p WHERE p."id" = NEW."agent_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."agent_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    IF NEW."conversation_id" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "conversations" p WHERE p."id" = NEW."conversation_id";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."conversation_id": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;

    -- Connector events have no chat/instance/person parent. Their tenant is
    -- derived from the PERSISTED subscription named in metadata -- never from a
    -- caller claim -- so the parentless journal row is still tenant-owned. The
    -- SELECT is RLS-scoped: a foreign subscription id derives nothing and the
    -- INSERT policy below remains the fail-closed authority.
    IF NEW."metadata" IS NOT NULL
       AND NEW."metadata" ->> 'source' = 'connector'
       AND NEW."metadata" ->> 'subscriptionId' IS NOT NULL THEN
        BEGIN
            v_parent := NULL;
            SELECT p."tenant_id" INTO v_parent
            FROM "connector_event_subscriptions" p
            WHERE p."id" = (NEW."metadata" ->> 'subscriptionId')::uuid;

            IF v_parent IS NOT NULL THEN
                IF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
                    RAISE EXCEPTION
                        'cross-tenant ownership conflict on %."subscriptionId": owning parents disagree', TG_TABLE_NAME
                        USING ERRCODE = '23514';
                END IF;
                v_resolved := v_parent;
                v_seen := true;
            END IF;
        EXCEPTION
            WHEN invalid_text_representation THEN
                v_parent := NULL;
        END;
    END IF;

    -- Never write a non-null child tenant id above a NULL-owner parent.
    IF NOT v_null_parent THEN
        NEW."tenant_id" := v_resolved;
    END IF;

    RETURN NEW;
END;
$$;
