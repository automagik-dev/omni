-- Multitenancy control plane — additive foundation (wish: omni-full-multitenancy, Group G1).
--
-- Establishes first-class tenant identity, principals/memberships, a bounded
-- fixed-role registry, an ISOLATED authentication credential index, separate
-- platform credentials, tenant key lineage/delegation foundations, and split
-- tenant/platform audit stores. Frozen G0 contract: ADR-0001/0003/0005/0006/0010
-- and OWNERSHIP_MATRIX "New ownership/control tables".
--
-- This migration is purely additive:
--   * It does NOT touch legacy `api_keys` or any existing business table.
--   * It adds NO tenant_id to existing tables (that is Group G2).
--   * It adds NO RLS policies or runtime roles (that is Group G3).
--
-- No hard tenant delete: every foreign key referencing `tenants` uses
-- ON DELETE RESTRICT (or NO ACTION for deferred/self references) so nothing can
-- cascade-delete a tenant or erase security/audit lineage. Tenant lifecycle
-- ends at `archived`.
--
-- Hand-written per the established convention (see 0032_genie_hosts.sql):
-- CREATE TABLE IF NOT EXISTS + explicit constraints, journal entry only, no
-- drizzle snapshot. Idempotent so a partial apply can be safely re-run.

-- ---------------------------------------------------------------------------
-- tenants — platform control plane
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "tenants" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "slug" varchar(63) NOT NULL,
    "display_name" varchar(255) NOT NULL,
    "status" varchar(20) DEFAULT 'active' NOT NULL,
    "policy_version" integer DEFAULT 1 NOT NULL,
    "revocation_epoch" integer DEFAULT 0 NOT NULL,
    "max_key_ttl_seconds" integer NOT NULL,
    "max_key_rate_limit" integer NOT NULL,
    "max_key_budget" integer NOT NULL,
    "created_by_principal_id" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "suspended_at" timestamp with time zone,
    "archived_at" timestamp with time zone,
    CONSTRAINT "tenants_status_check" CHECK ("status" IN ('active', 'suspended', 'archived')),
    CONSTRAINT "tenants_slug_format_check" CHECK ("slug" ~ '^[a-z0-9][a-z0-9-]*$'),
    CONSTRAINT "tenants_epochs_check" CHECK ("policy_version" >= 1 AND "revocation_epoch" >= 0),
    CONSTRAINT "tenants_key_policy_check" CHECK ("max_key_ttl_seconds" > 0 AND "max_key_rate_limit" > 0 AND "max_key_budget" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_slug_uq" ON "tenants" ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenants_status_idx" ON "tenants" ("status");
--> statement-breakpoint

-- Hard deletion is forbidden even for an otherwise-unreferenced tenant. The
-- lifecycle terminates at archived; future purge workflows require a separate,
-- explicitly approved model rather than DELETE.
CREATE OR REPLACE FUNCTION "reject_tenant_hard_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'tenant hard delete is forbidden';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "tenants_no_hard_delete" ON "tenants";
--> statement-breakpoint
CREATE TRIGGER "tenants_no_hard_delete"
BEFORE DELETE ON "tenants"
FOR EACH ROW EXECUTE FUNCTION "reject_tenant_hard_delete"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- principals — platform identity plane
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "principals" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "type" varchar(20) NOT NULL,
    "subject" varchar(255) NOT NULL,
    "display_name" varchar(255),
    "status" varchar(20) DEFAULT 'active' NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "disabled_at" timestamp with time zone,
    CONSTRAINT "principals_type_check" CHECK ("type" IN ('human', 'service')),
    CONSTRAINT "principals_status_check" CHECK ("status" IN ('active', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "principals_subject_uq" ON "principals" ("subject");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "principals_status_idx" ON "principals" ("status");
--> statement-breakpoint

-- Deferred FK: tenants.created_by_principal_id -> principals.id (RESTRICT).
DO $$ BEGIN
    ALTER TABLE "tenants" ADD CONSTRAINT "tenants_created_by_principal_id_fk"
        FOREIGN KEY ("created_by_principal_id") REFERENCES "principals" ("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- tenant_memberships — principal <-> tenant role relation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "tenant_memberships" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL,
    "principal_id" uuid NOT NULL,
    "role" varchar(32) NOT NULL,
    "status" varchar(20) DEFAULT 'active' NOT NULL,
    "invited_by_principal_id" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "disabled_at" timestamp with time zone,
    CONSTRAINT "tenant_memberships_role_check" CHECK ("role" IN ('tenant-owner', 'tenant-admin', 'tenant-operator', 'tenant-viewer')),
    CONSTRAINT "tenant_memberships_status_check" CHECK ("status" IN ('active', 'disabled')),
    CONSTRAINT "tenant_memberships_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT,
    CONSTRAINT "tenant_memberships_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "principals" ("id") ON DELETE RESTRICT,
    CONSTRAINT "tenant_memberships_invited_by_principal_id_fk" FOREIGN KEY ("invited_by_principal_id") REFERENCES "principals" ("id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_memberships_tenant_principal_uq" ON "tenant_memberships" ("tenant_id", "principal_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_memberships_tenant_id_uq" ON "tenant_memberships" ("tenant_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_memberships_tenant_principal_id_uq" ON "tenant_memberships" ("tenant_id", "principal_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_memberships_tenant_idx" ON "tenant_memberships" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_memberships_principal_idx" ON "tenant_memberships" ("principal_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- tenant_role_policies — fixed, bounded role ceiling registry (seed data)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "tenant_role_policies" (
    "role" varchar(32) PRIMARY KEY NOT NULL,
    "description" text NOT NULL,
    "max_scopes" text[] NOT NULL,
    "can_manage_memberships" boolean NOT NULL,
    "can_delegate_keys" boolean NOT NULL,
    "max_delegation_depth" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "tenant_role_policies_role_check" CHECK ("role" IN ('tenant-owner', 'tenant-admin', 'tenant-operator', 'tenant-viewer')),
    CONSTRAINT "tenant_role_policies_depth_check" CHECK ("max_delegation_depth" >= 0),
    CONSTRAINT "tenant_role_policies_no_platform_authority_check" CHECK (
        cardinality("max_scopes") > 0
        AND array_position("max_scopes", NULL) IS NULL
        AND NOT ('*' = ANY("max_scopes"))
        AND array_to_string("max_scopes", ',') !~ '(^|,)platform:'
    ),
    CONSTRAINT "tenant_role_policies_fixed_ceiling_check" CHECK (
        ("role" = 'tenant-owner' AND "max_scopes" = ARRAY['tenant:*', 'keys:delegate']::text[] AND "can_manage_memberships" AND "can_delegate_keys" AND "max_delegation_depth" = 1)
        OR ("role" = 'tenant-admin' AND "max_scopes" = ARRAY['tenant:*', 'keys:delegate']::text[] AND "can_manage_memberships" AND "can_delegate_keys" AND "max_delegation_depth" = 1)
        OR ("role" = 'tenant-operator' AND "max_scopes" = ARRAY['tenant:read', 'tenant:write']::text[] AND NOT "can_manage_memberships" AND NOT "can_delegate_keys" AND "max_delegation_depth" = 0)
        OR ("role" = 'tenant-viewer' AND "max_scopes" = ARRAY['tenant:read']::text[] AND NOT "can_manage_memberships" AND NOT "can_delegate_keys" AND "max_delegation_depth" = 0)
    )
);
--> statement-breakpoint

-- Seed the four fixed roles with bounded ceilings. No role carries '*'.
INSERT INTO "tenant_role_policies" ("role", "description", "max_scopes", "can_manage_memberships", "can_delegate_keys", "max_delegation_depth")
VALUES
    ('tenant-owner',    'Membership/lifecycle authority inside the tenant; cannot create platform authority.', ARRAY['tenant:*', 'keys:delegate']::text[], true,  true,  1),
    ('tenant-admin',    'Full tenant resource administration and bounded delegation.',                        ARRAY['tenant:*', 'keys:delegate']::text[], true,  true,  1),
    ('tenant-operator', 'Operational write access without membership/key-policy administration.',             ARRAY['tenant:read', 'tenant:write']::text[], false, false, 0),
    ('tenant-viewer',   'Read-only tenant access.',                                                           ARRAY['tenant:read']::text[], false, false, 0)
ON CONFLICT ("role") DO UPDATE SET
    "description" = EXCLUDED."description",
    "max_scopes" = EXCLUDED."max_scopes",
    "can_manage_memberships" = EXCLUDED."can_manage_memberships",
    "can_delegate_keys" = EXCLUDED."can_delegate_keys",
    "max_delegation_depth" = EXCLUDED."max_delegation_depth";
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- platform_api_keys — platform credential class (break-glass / automation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "platform_api_keys" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name" varchar(255) NOT NULL,
    "description" text,
    "key_prefix" varchar(12) NOT NULL,
    "key_hash" varchar(64) NOT NULL,
    "scopes" text[] NOT NULL,
    "status" varchar(20) DEFAULT 'active' NOT NULL,
    "principal_id" uuid NOT NULL,
    "created_by_principal_id" uuid,
    "expires_at" timestamp with time zone,
    "last_used_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    "revoked_by" varchar(255),
    "revoke_reason" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "platform_api_keys_status_check" CHECK ("status" IN ('active', 'revoked')),
    CONSTRAINT "platform_api_keys_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "principals" ("id") ON DELETE RESTRICT,
    CONSTRAINT "platform_api_keys_created_by_principal_id_fk" FOREIGN KEY ("created_by_principal_id") REFERENCES "principals" ("id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_api_keys_name_uq" ON "platform_api_keys" ("name");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_api_keys_key_hash_uq" ON "platform_api_keys" ("key_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_api_keys_id_principal_uq" ON "platform_api_keys" ("id", "principal_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_api_keys_key_prefix_idx" ON "platform_api_keys" ("key_prefix");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_api_keys_status_idx" ON "platform_api_keys" ("status");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- tenant_key_lineage — tenant-visible key metadata + delegation lineage
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "tenant_key_lineage" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL,
    "principal_id" uuid NOT NULL,
    "membership_id" uuid NOT NULL,
    "actor_role" varchar(32) NOT NULL,
    "name" varchar(255) NOT NULL,
    "key_prefix" varchar(12) NOT NULL,
    "scopes" text[] NOT NULL,
    "resource_constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "status" varchar(20) DEFAULT 'active' NOT NULL,
    "parent_key_id" uuid,
    "root_key_id" uuid NOT NULL,
    "depth" integer DEFAULT 0 NOT NULL,
    "created_by_principal_id" uuid,
    "expires_at" timestamp with time zone,
    "rate_limit" integer,
    "budget" integer,
    "revoked_at" timestamp with time zone,
    "revoke_reason" text,
    "revocation_epoch" integer DEFAULT 0 NOT NULL,
    "ancestor_revoked" boolean DEFAULT false NOT NULL,
    "ceiling_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "tenant_key_lineage_role_check" CHECK ("actor_role" IN ('tenant-owner', 'tenant-admin', 'tenant-operator', 'tenant-viewer')),
    CONSTRAINT "tenant_key_lineage_status_check" CHECK ("status" IN ('active', 'revoked', 'expired')),
    CONSTRAINT "tenant_key_lineage_depth_check" CHECK ("depth" >= 0),
    CONSTRAINT "tenant_key_lineage_positive_limits_check" CHECK (("rate_limit" IS NULL OR "rate_limit" > 0) AND ("budget" IS NULL OR "budget" > 0)),
    CONSTRAINT "tenant_key_lineage_principal_membership_pair_check" CHECK (("principal_id" IS NULL AND "membership_id" IS NULL) OR ("principal_id" IS NOT NULL AND "membership_id" IS NOT NULL)),
    CONSTRAINT "tenant_key_lineage_depth_shape_check" CHECK (("depth" = 0 AND "parent_key_id" IS NULL AND "root_key_id" = "id") OR ("depth" = 1 AND "parent_key_id" IS NOT NULL)),
    CONSTRAINT "tenant_key_lineage_no_platform_authority_check" CHECK (
        cardinality("scopes") > 0
        AND array_position("scopes", NULL) IS NULL
        AND NOT ('*' = ANY("scopes"))
        AND array_to_string("scopes", ',') !~ '(^|,)platform:'
    ),
    CONSTRAINT "tenant_key_lineage_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT,
    CONSTRAINT "tenant_key_lineage_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "principals" ("id") ON DELETE RESTRICT,
    CONSTRAINT "tenant_key_lineage_membership_id_fk" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships" ("id") ON DELETE RESTRICT,
    CONSTRAINT "tenant_key_lineage_membership_principal_fk" FOREIGN KEY ("tenant_id", "principal_id", "membership_id") REFERENCES "tenant_memberships" ("tenant_id", "principal_id", "id") ON DELETE RESTRICT,
    CONSTRAINT "tenant_key_lineage_parent_key_id_fk" FOREIGN KEY ("parent_key_id") REFERENCES "tenant_key_lineage" ("id") ON DELETE RESTRICT,
    CONSTRAINT "tenant_key_lineage_created_by_principal_id_fk" FOREIGN KEY ("created_by_principal_id") REFERENCES "principals" ("id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_key_lineage_tenant_id_uq" ON "tenant_key_lineage" ("tenant_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_key_lineage_auth_binding_uq" ON "tenant_key_lineage" ("tenant_id", "id", "principal_id", "membership_id", "actor_role");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_key_lineage_tenant_idx" ON "tenant_key_lineage" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_key_lineage_parent_idx" ON "tenant_key_lineage" ("parent_key_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_key_lineage_root_idx" ON "tenant_key_lineage" ("root_key_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_key_lineage_status_idx" ON "tenant_key_lineage" ("status");
--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "tenant_key_lineage" ADD CONSTRAINT "tenant_key_lineage_parent_tenant_fk"
        FOREIGN KEY ("tenant_id", "parent_key_id") REFERENCES "tenant_key_lineage" ("tenant_id", "id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "tenant_key_lineage" ADD CONSTRAINT "tenant_key_lineage_root_tenant_fk"
        FOREIGN KEY ("tenant_id", "root_key_id") REFERENCES "tenant_key_lineage" ("tenant_id", "id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- auth_credentials — ISOLATED authentication index (platform-owned)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "auth_credentials" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "credential_class" varchar(20) NOT NULL,
    "key_hash" varchar(64) NOT NULL,
    "key_prefix" varchar(12) NOT NULL,
    "tenant_id" uuid,
    "principal_id" uuid,
    "membership_id" uuid,
    "actor_role" varchar(32),
    "scopes" text[] NOT NULL,
    "status" varchar(20) DEFAULT 'active' NOT NULL,
    "tenant_key_lineage_id" uuid,
    "platform_api_key_id" uuid,
    "policy_snapshot_version" integer DEFAULT 1 NOT NULL,
    "revocation_epoch_snapshot" integer DEFAULT 0 NOT NULL,
    "expires_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "auth_credentials_class_check" CHECK ("credential_class" IN ('tenant', 'platform')),
    CONSTRAINT "auth_credentials_status_check" CHECK ("status" IN ('active', 'revoked', 'expired')),
    CONSTRAINT "auth_credentials_class_separation_check" CHECK (
        (
            "credential_class" = 'tenant'
            AND "tenant_id" IS NOT NULL
            AND "tenant_key_lineage_id" IS NOT NULL
            AND "actor_role" IS NOT NULL
            AND "principal_id" IS NOT NULL
            AND "membership_id" IS NOT NULL
            AND "platform_api_key_id" IS NULL
        ) OR (
            "credential_class" = 'platform'
            AND "tenant_id" IS NULL
            AND "platform_api_key_id" IS NOT NULL
            AND "principal_id" IS NOT NULL
            AND "membership_id" IS NULL
            AND "tenant_key_lineage_id" IS NULL
            AND "actor_role" IS NULL
        )
    ),
    CONSTRAINT "auth_credentials_principal_membership_pair_check" CHECK ("credential_class" <> 'tenant' OR (("principal_id" IS NULL AND "membership_id" IS NULL) OR ("principal_id" IS NOT NULL AND "membership_id" IS NOT NULL))),
    CONSTRAINT "auth_credentials_tenant_no_wildcard_check" CHECK (
        "credential_class" <> 'tenant' OR (
            cardinality("scopes") > 0
            AND array_position("scopes", NULL) IS NULL
            AND NOT ('*' = ANY("scopes"))
            AND array_to_string("scopes", ',') !~ '(^|,)platform:'
        )
    ),
    CONSTRAINT "auth_credentials_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT,
    CONSTRAINT "auth_credentials_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "principals" ("id") ON DELETE RESTRICT,
    CONSTRAINT "auth_credentials_membership_id_fk" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships" ("id") ON DELETE RESTRICT,
    CONSTRAINT "auth_credentials_tenant_key_lineage_id_fk" FOREIGN KEY ("tenant_key_lineage_id") REFERENCES "tenant_key_lineage" ("id") ON DELETE RESTRICT,
    CONSTRAINT "auth_credentials_platform_api_key_id_fk" FOREIGN KEY ("platform_api_key_id") REFERENCES "platform_api_keys" ("id") ON DELETE RESTRICT,
    CONSTRAINT "auth_credentials_tenant_lineage_fk" FOREIGN KEY ("tenant_id", "tenant_key_lineage_id") REFERENCES "tenant_key_lineage" ("tenant_id", "id") ON DELETE RESTRICT,
    CONSTRAINT "auth_credentials_tenant_lineage_binding_fk" FOREIGN KEY ("tenant_id", "tenant_key_lineage_id", "principal_id", "membership_id", "actor_role") REFERENCES "tenant_key_lineage" ("tenant_id", "id", "principal_id", "membership_id", "actor_role") ON DELETE RESTRICT,
    CONSTRAINT "auth_credentials_membership_principal_fk" FOREIGN KEY ("tenant_id", "principal_id", "membership_id") REFERENCES "tenant_memberships" ("tenant_id", "principal_id", "id") ON DELETE RESTRICT,
    CONSTRAINT "auth_credentials_platform_source_principal_fk" FOREIGN KEY ("platform_api_key_id", "principal_id") REFERENCES "platform_api_keys" ("id", "principal_id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_credentials_key_hash_uq" ON "auth_credentials" ("key_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_credentials_tenant_lineage_uq" ON "auth_credentials" ("tenant_key_lineage_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_credentials_platform_source_uq" ON "auth_credentials" ("platform_api_key_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_credentials_class_tenant_idx" ON "auth_credentials" ("credential_class", "tenant_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- tenant_audit_logs — append-only, tenant-scoped audit store
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "tenant_audit_logs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL,
    "actor_principal_id" uuid,
    "actor_credential_id" uuid NOT NULL,
    "action" varchar(100) NOT NULL,
    "target_type" varchar(100),
    "target_id" varchar(255),
    "request_id" varchar(100) NOT NULL,
    "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "tenant_audit_logs_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT,
    CONSTRAINT "tenant_audit_logs_actor_principal_id_fk" FOREIGN KEY ("actor_principal_id") REFERENCES "principals" ("id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_audit_logs_tenant_idx" ON "tenant_audit_logs" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_audit_logs_created_at_idx" ON "tenant_audit_logs" ("created_at");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- platform_audit_logs — append-only platform-admin audit store
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "platform_audit_logs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "actor_principal_id" uuid,
    "actor_credential_id" uuid NOT NULL,
    "action" varchar(100) NOT NULL,
    "target_tenant_id" uuid,
    "reason" text NOT NULL,
    "request_id" varchar(100) NOT NULL,
    "before_metadata" jsonb,
    "after_metadata" jsonb,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "platform_audit_logs_target_shape_check" CHECK ("target_tenant_id" IS NOT NULL OR "action" = 'tenant.list'),
    CONSTRAINT "platform_audit_logs_actor_principal_id_fk" FOREIGN KEY ("actor_principal_id") REFERENCES "principals" ("id") ON DELETE RESTRICT,
    CONSTRAINT "platform_audit_logs_target_tenant_id_fk" FOREIGN KEY ("target_tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_audit_logs_target_tenant_idx" ON "platform_audit_logs" ("target_tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_audit_logs_created_at_idx" ON "platform_audit_logs" ("created_at");
--> statement-breakpoint

-- Enforce append-only audit semantics in the database, independent of application code.
CREATE OR REPLACE FUNCTION "reject_audit_log_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'multitenancy audit logs are append-only';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "tenant_audit_logs_append_only" ON "tenant_audit_logs";
--> statement-breakpoint
CREATE TRIGGER "tenant_audit_logs_append_only"
BEFORE UPDATE OR DELETE ON "tenant_audit_logs"
FOR EACH ROW EXECUTE FUNCTION "reject_audit_log_mutation"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "tenant_audit_logs_no_truncate" ON "tenant_audit_logs";
--> statement-breakpoint
CREATE TRIGGER "tenant_audit_logs_no_truncate"
BEFORE TRUNCATE ON "tenant_audit_logs"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_audit_log_mutation"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "platform_audit_logs_append_only" ON "platform_audit_logs";
--> statement-breakpoint
CREATE TRIGGER "platform_audit_logs_append_only"
BEFORE UPDATE OR DELETE ON "platform_audit_logs"
FOR EACH ROW EXECUTE FUNCTION "reject_audit_log_mutation"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "platform_audit_logs_no_truncate" ON "platform_audit_logs";
--> statement-breakpoint
CREATE TRIGGER "platform_audit_logs_no_truncate"
BEFORE TRUNCATE ON "platform_audit_logs"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_audit_log_mutation"();
