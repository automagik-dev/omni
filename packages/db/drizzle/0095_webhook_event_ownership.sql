-- Generic webhook event ownership (follow-up to #1531 / #1476).
-- An owned source has no chat/instance parent; derive its journal owner from
-- the persisted source identified by server-stamped metadata.webhookSourceId.
-- Payload tenant claims and source names are never ownership evidence. Missing,
-- malformed, unowned or RLS-hidden sources derive no owner; existing RLS rejects
-- the insert under enforcement. Preserve every 0092 parent/connector check.
--
-- no-schema-change: only the frozen ownership trigger function is replaced;
-- no table/column/index or RLS changes. Prior migrations remain untouched.
-- Hand-written following the additive, idempotent 0090 connector precedent.

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

    -- Typed ingress rows (Decision #16) name the persisted connector owner.
    -- This SELECT remains RLS-scoped, just like the subscription path above.
    IF NEW."metadata" IS NOT NULL
       AND NEW."metadata" ->> 'source' = 'connector'
       AND NEW."metadata" ? 'subscriptionIds'
       AND NEW."metadata" ->> 'connectorId' IS NOT NULL THEN
        BEGIN
            v_parent := NULL;
            SELECT p."tenant_id" INTO v_parent
            FROM "connectors" p
            WHERE p."id" = (NEW."metadata" ->> 'connectorId')::uuid;

            IF v_parent IS NOT NULL THEN
                IF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
                    RAISE EXCEPTION
                        'cross-tenant ownership conflict on %."connectorId": owning parents disagree', TG_TABLE_NAME
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

    -- Generic webhook ingress stamps this source id from its persisted row,
    -- never from the delivery payload. The lookup remains under caller RLS.
    IF NEW."metadata" IS NOT NULL
       AND NEW."metadata" ->> 'source' = 'webhook'
       AND NEW."metadata" ->> 'webhookSourceId' IS NOT NULL THEN
        BEGIN
            v_parent := NULL;
            SELECT p."tenant_id" INTO v_parent
            FROM "webhook_sources" p
            WHERE p."id" = (NEW."metadata" ->> 'webhookSourceId')::uuid;

            IF v_parent IS NULL THEN
                v_null_parent := true;
            ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
                RAISE EXCEPTION
                    'cross-tenant ownership conflict on %."webhookSourceId": owning parents disagree', TG_TABLE_NAME
                    USING ERRCODE = '23514';
            ELSE
                v_resolved := v_parent;
                v_seen := true;
            END IF;
        EXCEPTION
            WHEN invalid_text_representation THEN
                v_null_parent := true;
        END;
    END IF;

    -- Never write a non-null child tenant id above a NULL-owner parent.
    IF NOT v_null_parent THEN
        NEW."tenant_id" := v_resolved;
    END IF;

    RETURN NEW;
END;
$$;
