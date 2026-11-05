-- Connector-keyed ingress schema and typed journal ownership.
-- Wish: gitlab-sdlc-connector, Group 2. Existing ClickUp bindings keep their route and secret.
-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).

ALTER TABLE "connectors" ADD COLUMN IF NOT EXISTS "hook_secret" text;
ALTER TABLE "connectors" ADD COLUMN IF NOT EXISTS "total_unmatched" integer NOT NULL DEFAULT 0;
ALTER TABLE "connectors" ADD COLUMN IF NOT EXISTS "last_unmatched_at" timestamp with time zone;
ALTER TABLE "connectors" ADD COLUMN IF NOT EXISTS "last_unmatched_event_type" varchar(200);

ALTER TABLE "connector_event_subscriptions" ADD COLUMN IF NOT EXISTS "ingress" varchar(20) NOT NULL DEFAULT 'subscription';
ALTER TABLE "connector_event_subscriptions" ALTER COLUMN "target_automation_id" DROP NOT NULL;
ALTER TABLE "connector_event_subscriptions" ALTER COLUMN "verification_secret" DROP NOT NULL;

DO $omni$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'connector_event_subscriptions_ingress_secret_check'
      AND conrelid = 'public.connector_event_subscriptions'::regclass
  ) THEN
    ALTER TABLE "connector_event_subscriptions"
      ADD CONSTRAINT "connector_event_subscriptions_ingress_secret_check"
      CHECK (("ingress" = 'subscription' AND "verification_secret" IS NOT NULL)
          OR ("ingress" = 'connector' AND "verification_secret" IS NULL));
  END IF;
END;
$omni$;

-- Preserve connector_event_subscriptions_binding_uq for targeted bindings.
CREATE UNIQUE INDEX IF NOT EXISTS "connector_event_subscriptions_untargeted_uq"
  ON "connector_event_subscriptions" ("connector_id", "provider_event_key")
  WHERE "target_automation_id" IS NULL;

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

    -- Never write a non-null child tenant id above a NULL-owner parent.
    IF NOT v_null_parent THEN
        NEW."tenant_id" := v_resolved;
    END IF;

    RETURN NEW;
END;
$$;
