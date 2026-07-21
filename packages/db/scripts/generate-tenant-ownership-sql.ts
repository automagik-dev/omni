/**
 * Generates the G2 tenant-ownership DDL from `tenancy-ownership.ts`.
 *
 * Two artifacts come out of the same spec so they can never drift:
 *   1. `drizzle/0041_tenant_ownership_columns.sql` — the transactional migration.
 *   2. the statement list consumed by the online DDL runner (`online-ddl.ts`),
 *      which builds the high-volume indexes with CREATE INDEX CONCURRENTLY
 *      OUTSIDE the migration transaction.
 *
 * `bun run scripts/generate-tenant-ownership-sql.ts --check` re-generates and
 * diffs instead of writing, so CI fails when the committed SQL drifts.
 *
 * ONLINE-DDL STRATEGY (WISH "additive phase" + `applyMigrations()` constraints)
 * ----------------------------------------------------------------------------
 * `applyMigrations()` wraps the whole migrator run in ONE transaction under an
 * advisory lock, and API startup times migrations out after 60 seconds. So:
 *
 *   * Every statement in 0041 is transaction-safe and metadata-only:
 *     `ADD COLUMN ... uuid` with no default and no NOT NULL never rewrites a
 *     table (PostgreSQL 11+), and every foreign key is added `NOT VALID`, which
 *     takes a brief lock and scans nothing.
 *   * Index builds are the only statements that would scan a table. 0041 still
 *     emits every one of them with `IF NOT EXISTS`, so a FRESH install gets a
 *     complete schema from the migration alone and never silently ships without
 *     a tenant-aware unique index or a composite-FK target index.
 *   * 0041 is fully idempotent (`IF NOT EXISTS` everywhere, `DO` blocks guarded
 *     on `pg_constraint`/`pg_trigger`), which is what makes the online phase a
 *     pure front-run rather than a second source of truth.
 *
 * Operator sequence on a large database (the `volume: 'high'` tables are the
 * ones where this matters):
 *     1. `bun run db:online-ddl`  — adds the nullable columns (instant) and
 *        builds every index with CONCURRENTLY. No long lock, resumable,
 *        and it repairs an INVALID index left by an interrupted build.
 *     2. `bun run db:migrate`     — 0041 finds the columns/indexes present and
 *        only adds the NOT VALID constraints and triggers.
 *
 * On a fresh or small install step 1 is unnecessary: 0041 alone creates
 * everything, and the online runner is then a no-op. Both orders converge on the
 * same schema, which `tenancy-postgres.test.ts` proves against real PostgreSQL.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TENANT_OWNERSHIP_SPECS,
  type TenantOwnershipSpec,
  addColumnStatements,
  allIndexStatements,
  compositeFkName,
  tenantIdUniqueIndexName,
} from '../src/tenancy-ownership';

const BREAK = '--> statement-breakpoint';

/** Wrap a constraint add so re-running the migration is a no-op. */
function addConstraintIfMissing(table: string, name: string, definition: string): string {
  return `DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = '${name}' AND conrelid = '"${table}"'::regclass
    ) THEN
        ALTER TABLE "${table}" ADD CONSTRAINT "${name}" ${definition};
    END IF;
END $$;`;
}

function createTriggerIfMissing(table: string, trigger: string, body: string): string {
  return `DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = '${trigger}' AND tgrelid = '"${table}"'::regclass AND NOT tgisinternal
    ) THEN
        ${body}
    END IF;
END $$;`;
}

// ---------------------------------------------------------------------------
// Dual-write derivation triggers
// ---------------------------------------------------------------------------

/**
 * Trusted dual-write propagation, enforced at the database boundary.
 *
 * Placing derivation in a BEFORE INSERT trigger rather than in each of the 168
 * application write sites gives three properties the application layer cannot:
 *
 *   * It runs inside the writing statement's own transaction, so every parent's
 *     tenant id is read at exactly the isolation level of the write.
 *   * It cannot be bypassed — by an existing writer, a future writer, an
 *     operational script, or a pre-G2 binary still in the fleet (ADR-0007
 *     mixed-version state 1).
 *   * Tenant identity is not caller-settable: the trigger discards whatever the
 *     caller supplied before deriving.
 *
 * The rule is exactly the G2 derivation precedence:
 *   * a parent is "applicable" when its FK column on this row is non-null;
 *   * all applicable parents non-null and equal -> persist that tenant id;
 *   * any applicable parent still NULL-owner    -> persist NULL;
 *   * two applicable parents disagree           -> reject the write.
 */
function derivationTriggerFunction(spec: TenantOwnershipSpec): string {
  const fn = `omni_tenant_ownership_${spec.table}`;
  if (spec.parents.length === 0) {
    // `unowned`: no G0-authorised source of ownership in G2. Force NULL so no
    // writer can stamp an unproven tenant id onto the row.
    return `CREATE OR REPLACE FUNCTION "${fn}"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW."tenant_id" := NULL;
    RETURN NEW;
END;
$$;`;
  }

  const blocks = spec.parents
    .map(
      (parent) => `
    IF NEW."${parent.column}" IS NOT NULL THEN
        SELECT p."tenant_id" INTO v_parent FROM "${parent.parentTable}" p WHERE p."id" = NEW."${parent.column}";
        IF v_parent IS NULL THEN
            v_null_parent := true;
        ELSIF v_seen AND v_resolved IS DISTINCT FROM v_parent THEN
            RAISE EXCEPTION
                'cross-tenant ownership conflict on %."${parent.column}": owning parents disagree', TG_TABLE_NAME
                USING ERRCODE = '23514';
        ELSE
            v_resolved := v_parent;
            v_seen := true;
        END IF;
    END IF;`,
    )
    .join('\n');

  return `CREATE OR REPLACE FUNCTION "${fn}"()
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
${blocks}

    -- Never write a non-null child tenant id above a NULL-owner parent.
    IF NOT v_null_parent THEN
        NEW."tenant_id" := v_resolved;
    END IF;

    RETURN NEW;
END;
$$;`;
}

// ---------------------------------------------------------------------------
// New tables: split destinations + migration ledger
// ---------------------------------------------------------------------------

const NEW_TABLES_SQL = `
-- ---------------------------------------------------------------------------
-- Split destinations — ADDITIVE SCHEMA CONTRACT ONLY.
--
-- G0 marks seven legacy tables \`split\`. G1 delivered the key/auth/audit split;
-- these are the five that remain. G2 creates the destinations EMPTY: it copies
-- no legacy row, reclassifies nothing, and switches no runtime read or write
-- path. Every legacy table keeps its exact HEAD shape and behaviour. Honouring
-- \`split\` literally also means none of the five legacy tables receives an
-- ambiguous nullable tenant owner.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "platform_provider_catalog" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "provider_type" varchar(50) NOT NULL,
    "display_name" varchar(255) NOT NULL,
    "description" text,
    "capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "config_schema" jsonb,
    "is_builtin" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "platform_provider_catalog_type_uq" UNIQUE ("provider_type")
);
${BREAK}

CREATE TABLE IF NOT EXISTS "tenant_provider_config" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
    "provider_type" varchar(50) NOT NULL,
    "name" varchar(255) NOT NULL,
    "base_url" text,
    "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
${BREAK}
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_provider_config_tenant_name_uq" ON "tenant_provider_config" ("tenant_id", "name");
${BREAK}

CREATE TABLE IF NOT EXISTS "platform_settings" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "key" varchar(255) NOT NULL,
    "value" jsonb NOT NULL,
    "description" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "platform_settings_key_uq" UNIQUE ("key")
);
${BREAK}

CREATE TABLE IF NOT EXISTS "tenant_settings" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
    "key" varchar(255) NOT NULL,
    "value" jsonb NOT NULL,
    "description" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
${BREAK}
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_settings_tenant_key_uq" ON "tenant_settings" ("tenant_id", "key");
${BREAK}

CREATE TABLE IF NOT EXISTS "platform_setting_change_history" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "setting_id" uuid REFERENCES "platform_settings" ("id") ON DELETE RESTRICT,
    "key" varchar(255) NOT NULL,
    "old_value" jsonb,
    "new_value" jsonb,
    "changed_by" varchar(255),
    "reason" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
${BREAK}

CREATE TABLE IF NOT EXISTS "tenant_setting_change_history" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
    "setting_id" uuid REFERENCES "tenant_settings" ("id") ON DELETE RESTRICT,
    "key" varchar(255) NOT NULL,
    "old_value" jsonb,
    "new_value" jsonb,
    "changed_by" varchar(255),
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
${BREAK}
CREATE INDEX IF NOT EXISTS "tenant_setting_change_history_tenant_idx" ON "tenant_setting_change_history" ("tenant_id");
${BREAK}

CREATE TABLE IF NOT EXISTS "platform_plugin_storage" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "plugin_id" varchar(100) NOT NULL,
    "key" varchar(255) NOT NULL,
    "value" jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "platform_plugin_storage_plugin_key_uq" UNIQUE ("plugin_id", "key")
);
${BREAK}

CREATE TABLE IF NOT EXISTS "tenant_plugin_storage" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
    "plugin_id" varchar(100) NOT NULL,
    "key" varchar(255) NOT NULL,
    "value" jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
${BREAK}
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_plugin_storage_tenant_plugin_key_uq" ON "tenant_plugin_storage" ("tenant_id", "plugin_id", "key");
${BREAK}

CREATE TABLE IF NOT EXISTS "platform_payload_storage_config" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "event_type" varchar(100) NOT NULL,
    "backend" varchar(50) NOT NULL,
    "retention_days" integer,
    "max_payload_bytes" integer,
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "platform_payload_storage_config_event_type_uq" UNIQUE ("event_type")
);
${BREAK}

CREATE TABLE IF NOT EXISTS "tenant_payload_storage_overrides" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
    "event_type" varchar(100) NOT NULL,
    "retention_days" integer,
    "max_payload_bytes" integer,
    "quota_bytes" bigint,
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
${BREAK}
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_payload_storage_overrides_tenant_event_uq" ON "tenant_payload_storage_overrides" ("tenant_id", "event_type");
${BREAK}

-- ---------------------------------------------------------------------------
-- tenant_migration_ledger — platform migration plane (WISH lines 185-190).
--
-- The contract is CONJUNCTIVE: a row is only a valid ownership decision when it
-- carries source identity, target tenant, the decision rule, a pre-image and a
-- post-image with checksums, an inverse OR an explicit compensating action, the
-- WAL/LSN high-water mark, the writer epoch, status, ambiguity/quarantine state,
-- the reconciliation receipt, and the attempt/checkpoint data an interrupted run
-- needs to resume idempotently.
--
-- The head row is mutable so a resume can advance status/attempt/checkpoint.
-- Every version of it is mirrored into tenant_migration_ledger_history, which
-- is append-only at the database boundary.
--
-- Images are REDACTED projections plus checksums. No plaintext credential,
-- secret value, or unredacted sensitive payload is ever stored here; the
-- checksum is what proves the untouched row, not a copy of it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "tenant_migration_ledger" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "source_table" varchar(63) NOT NULL,
    "source_primary_key" jsonb NOT NULL,
    "target_tenant_id" uuid REFERENCES "tenants" ("id") ON DELETE RESTRICT,
    "decision_rule" text NOT NULL,
    "pre_image_redacted" jsonb NOT NULL,
    "pre_image_checksum" varchar(64) NOT NULL,
    "post_image_redacted" jsonb,
    "post_image_checksum" varchar(64),
    "inverse_action" jsonb,
    "compensating_action" jsonb,
    "wal_lsn_high_water" pg_lsn NOT NULL,
    "writer_epoch" bigint NOT NULL,
    "status" varchar(20) DEFAULT 'planned' NOT NULL,
    "ambiguity_state" varchar(20) DEFAULT 'none' NOT NULL,
    "reconciliation_receipt" jsonb,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "checkpoint" jsonb,
    "redaction_policy" varchar(100) NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "tenant_migration_ledger_status_check"
        CHECK ("status" IN ('planned', 'applied', 'compensated', 'failed', 'quarantined')),
    CONSTRAINT "tenant_migration_ledger_ambiguity_check"
        CHECK ("ambiguity_state" IN ('none', 'ambiguous', 'quarantined')),
    CONSTRAINT "tenant_migration_ledger_checksums_check"
        CHECK ("pre_image_checksum" ~ '^[0-9a-f]{64}$'
           AND ("post_image_checksum" IS NULL OR "post_image_checksum" ~ '^[0-9a-f]{64}$')),
    -- Every decision must be reversible: an inverse action, or an explicit
    -- compensating action when the write is not literally invertible.
    CONSTRAINT "tenant_migration_ledger_inverse_or_compensating_check"
        CHECK ("inverse_action" IS NOT NULL OR "compensating_action" IS NOT NULL),
    -- An applied decision must name the tenant it assigned and carry its post-image.
    CONSTRAINT "tenant_migration_ledger_applied_completeness_check"
        CHECK ("status" <> 'applied'
            OR ("target_tenant_id" IS NOT NULL AND "post_image_checksum" IS NOT NULL
                AND "reconciliation_receipt" IS NOT NULL)),
    -- Ambiguity is never silently resolved into an assignment.
    CONSTRAINT "tenant_migration_ledger_quarantine_check"
        CHECK ("ambiguity_state" = 'none' OR "target_tenant_id" IS NULL),
    CONSTRAINT "tenant_migration_ledger_attempts_check" CHECK ("attempt_count" >= 0),
    CONSTRAINT "tenant_migration_ledger_epoch_check" CHECK ("writer_epoch" >= 0)
);
${BREAK}
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_migration_ledger_source_uq"
    ON "tenant_migration_ledger" ("source_table", "source_primary_key");
${BREAK}
CREATE INDEX IF NOT EXISTS "tenant_migration_ledger_status_idx" ON "tenant_migration_ledger" ("status");
${BREAK}
CREATE INDEX IF NOT EXISTS "tenant_migration_ledger_tenant_idx"
    ON "tenant_migration_ledger" ("target_tenant_id") WHERE "target_tenant_id" IS NOT NULL;
${BREAK}

CREATE TABLE IF NOT EXISTS "tenant_migration_ledger_history" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "ledger_id" uuid NOT NULL,
    "revision" integer NOT NULL,
    "source_table" varchar(63) NOT NULL,
    "source_primary_key" jsonb NOT NULL,
    "target_tenant_id" uuid,
    "decision_rule" text NOT NULL,
    "pre_image_checksum" varchar(64) NOT NULL,
    "post_image_checksum" varchar(64),
    "wal_lsn_high_water" pg_lsn NOT NULL,
    "writer_epoch" bigint NOT NULL,
    "status" varchar(20) NOT NULL,
    "ambiguity_state" varchar(20) NOT NULL,
    "attempt_count" integer NOT NULL,
    "checkpoint" jsonb,
    "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "tenant_migration_ledger_history_revision_uq" UNIQUE ("ledger_id", "revision")
);
${BREAK}
CREATE INDEX IF NOT EXISTS "tenant_migration_ledger_history_ledger_idx"
    ON "tenant_migration_ledger_history" ("ledger_id");
${BREAK}

CREATE OR REPLACE FUNCTION "omni_append_migration_ledger_history"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_revision integer;
BEGIN
    SELECT COALESCE(MAX("revision"), 0) + 1 INTO v_revision
    FROM "tenant_migration_ledger_history" WHERE "ledger_id" = NEW."id";

    INSERT INTO "tenant_migration_ledger_history" (
        "ledger_id", "revision", "source_table", "source_primary_key", "target_tenant_id",
        "decision_rule", "pre_image_checksum", "post_image_checksum", "wal_lsn_high_water",
        "writer_epoch", "status", "ambiguity_state", "attempt_count", "checkpoint"
    ) VALUES (
        NEW."id", v_revision, NEW."source_table", NEW."source_primary_key", NEW."target_tenant_id",
        NEW."decision_rule", NEW."pre_image_checksum", NEW."post_image_checksum", NEW."wal_lsn_high_water",
        NEW."writer_epoch", NEW."status", NEW."ambiguity_state", NEW."attempt_count", NEW."checkpoint"
    );
    RETURN NEW;
END;
$$;
${BREAK}

CREATE OR REPLACE FUNCTION "omni_reject_migration_ledger_history_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'migration ledger history is append-only';
END;
$$;
${BREAK}
`;

// ---------------------------------------------------------------------------
// Migration assembly
// ---------------------------------------------------------------------------

function buildMigration(): string {
  const parts: string[] = [];

  parts.push(`-- Tenant ownership columns and constraints — additive phase
-- (wish: omni-full-multitenancy, Group G2).
--
-- GENERATED FROM packages/db/src/tenancy-ownership.ts.
-- Regenerate with \`bun run scripts/generate-tenant-ownership-sql.ts\`;
-- \`--check\` fails when the committed file drifts from the spec.
--
-- Frozen G0 inputs: OWNERSHIP_MANIFEST.yaml (29 tenant, 7 split, 2 platform
-- legacy tables) and OWNERSHIP_MATRIX.md. ADR-0001 ownership classes,
-- ADR-0002 person/platform identity split, ADR-0004 RLS transaction context
-- (schema only here), ADR-0007 mixed-version writer fence.
--
-- LEGACY-SAFE BY CONSTRUCTION:
--   * \`tenant_id\` is NULLABLE with no default on all 29 tenant tables. Legacy
--     rows stay valid; NOT NULL waits for the G6 zero-reconciliation gate.
--   * Every pre-existing global unique constraint is untouched, so a pre-G2
--     binary keeps writing successfully (mixed-version state 1).
--   * Tenant-aware unique indexes are PARTIAL on \`tenant_id IS NOT NULL\`, so
--     they cannot reject any row or write that succeeds today.
--   * Composite same-tenant foreign keys are \`NOT VALID\`: existing rows are
--     never scanned, and MATCH SIMPLE means a row with a NULL tenant_id is not
--     checked at all. Validation belongs to the later reconciliation gate.
--   * No DROP, no RENAME, no destructive ALTER, no read-path change, no RLS.
--
-- ONLINE DDL: this file is transaction-safe end to end. \`ADD COLUMN <uuid>\`
-- with no default does not rewrite a table, and \`NOT VALID\` constraints scan
-- nothing. Indexes on high-volume tables are NOT built here — they are built by
-- the online runner (\`packages/db/src/online-ddl.ts\`) with
-- CREATE INDEX CONCURRENTLY, which cannot run inside the transaction
-- \`applyMigrations()\` opens. Every statement is idempotent, so the two phases
-- may run in either order and converge.\n`);

  parts.push(`-- ---------------------------------------------------------------------------
-- 1. Nullable ownership column on each of the 29 tenant tables.
-- ---------------------------------------------------------------------------`);
  for (const statement of addColumnStatements()) parts.push(`${statement}\n${BREAK}`);

  parts.push(`
-- ---------------------------------------------------------------------------
-- 2. Ownership references the tenant control plane. NOT VALID: no scan, and a
--    tenant can never be cascade-deleted through a business row.
-- ---------------------------------------------------------------------------`);
  for (const spec of TENANT_OWNERSHIP_SPECS) {
    parts.push(
      `${addConstraintIfMissing(
        spec.table,
        `${spec.table}_tenant_fk`,
        'FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT NOT VALID',
      )}\n${BREAK}`,
    );
  }

  const indexes = allIndexStatements();
  parts.push(`
-- ---------------------------------------------------------------------------
-- 3. Supporting indexes. Every one is \`IF NOT EXISTS\`, so a fresh install gets
--    a COMPLETE schema from this migration alone.
--
--    On a large database run \`bun run db:online-ddl\` FIRST: it adds the
--    columns and builds these same indexes with CREATE INDEX CONCURRENTLY,
--    after which every statement below is a no-op and the migration takes no
--    long lock. High-volume tables where that matters:
--    ${[...new Set(TENANT_OWNERSHIP_SPECS.filter((s) => s.volume === 'high').map((s) => s.table))].join(', ')}.
-- ---------------------------------------------------------------------------`);
  for (const { statement } of indexes) {
    parts.push(`${statement.plain}\n${BREAK}`);
  }

  parts.push(`
-- ---------------------------------------------------------------------------
-- 4. Composite same-tenant foreign keys, all NOT VALID.
--    (tenant_id, <fk>) -> parent (tenant_id, id) makes a cross-tenant join
--    structurally impossible once ownership is populated, while MATCH SIMPLE
--    leaves every NULL-owner legacy row unchecked.
--
--    A composite FK needs a VALID parent (tenant_id, id) unique index. Step 3
--    created it, but an interrupted CONCURRENTLY build from the online phase can
--    leave an INVALID index behind. Rather than fail startup, the DO block warns
--    and skips; \`db:online-ddl\` repairs the index and re-running migrations
--    adds the constraint.
-- ---------------------------------------------------------------------------`);
  for (const spec of TENANT_OWNERSHIP_SPECS) {
    for (const parent of spec.parents) {
      const name = compositeFkName(spec.table, parent.column);
      const targetIndex = tenantIdUniqueIndexName(parent.parentTable);
      parts.push(`DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = '${name}' AND conrelid = '"${spec.table}"'::regclass
    ) THEN
        IF EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = '${targetIndex}' AND c.relkind = 'i' AND i.indisvalid AND i.indisready
        ) THEN
            ALTER TABLE "${spec.table}" ADD CONSTRAINT "${name}"
                FOREIGN KEY ("tenant_id", "${parent.column}")
                REFERENCES "${parent.parentTable}" ("tenant_id", "id")
                ON DELETE RESTRICT NOT VALID;
        ELSE
            RAISE WARNING 'skipping %: parent unique index % is missing; run the online DDL phase then re-run migrations', '${name}', '${targetIndex}';
        END IF;
    END IF;
END $$;
${BREAK}`);
    }
  }

  parts.push(`
-- ---------------------------------------------------------------------------
-- 5. Trusted dual-write derivation triggers.
--
--    NOT gated by OMNI_MULTITENANCY_ENABLED: an old-shaped write stays valid and
--    leaves ownership NULL, while a write under fully-owned parents persists the
--    derived tenant id even with tenant mode off. That is what stops a pre-G2
--    binary from creating an unowned row beneath an owned parent.
--
--    Tenant identity here comes only from parents already persisted in this
--    database. Request bodies, headers, query metadata, person metadata, the
--    quarantined OmniCustomerContext.tenantId, and OMNI_TENANT_ID are never
--    consulted — the trigger discards any caller-supplied value first.
--
--    \`instances\` is the sole ownership root (G0) and has NO trigger: its
--    tenant id comes from authenticated server-side context through the
--    dedicated write path in packages/db/src/tenancy-dual-write.ts.
-- ---------------------------------------------------------------------------`);
  for (const spec of TENANT_OWNERSHIP_SPECS) {
    if (spec.derivation === 'root') continue;
    const fn = `omni_tenant_ownership_${spec.table}`;
    const trigger = `${spec.table}_tenant_ownership_trg`;
    parts.push(`${derivationTriggerFunction(spec)}\n${BREAK}`);
    parts.push(
      `${createTriggerIfMissing(
        spec.table,
        trigger,
        `CREATE TRIGGER "${trigger}" BEFORE INSERT ON "${spec.table}"
            FOR EACH ROW EXECUTE FUNCTION "${fn}"();`,
      )}\n${BREAK}`,
    );
  }

  parts.push(NEW_TABLES_SQL);

  parts.push(
    `${createTriggerIfMissing(
      'tenant_migration_ledger',
      'tenant_migration_ledger_history_trg',
      `CREATE TRIGGER "tenant_migration_ledger_history_trg"
            AFTER INSERT OR UPDATE ON "tenant_migration_ledger"
            FOR EACH ROW EXECUTE FUNCTION "omni_append_migration_ledger_history"();`,
    )}\n${BREAK}`,
  );

  parts.push(
    `${createTriggerIfMissing(
      'tenant_migration_ledger_history',
      'tenant_migration_ledger_history_immutable_trg',
      `CREATE TRIGGER "tenant_migration_ledger_history_immutable_trg"
            BEFORE UPDATE OR DELETE ON "tenant_migration_ledger_history"
            FOR EACH ROW EXECUTE FUNCTION "omni_reject_migration_ledger_history_mutation"();`,
    )}\n${BREAK}`,
  );

  parts.push(
    `${createTriggerIfMissing(
      'tenant_migration_ledger_history',
      'tenant_migration_ledger_history_truncate_trg',
      `CREATE TRIGGER "tenant_migration_ledger_history_truncate_trg"
            BEFORE TRUNCATE ON "tenant_migration_ledger_history"
            FOR EACH STATEMENT EXECUTE FUNCTION "omni_reject_migration_ledger_history_mutation"();`,
    )}\n`,
  );

  return `${parts.join('\n')}\n`;
}

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'drizzle', '0041_tenant_ownership_columns.sql');

if (import.meta.main) {
  const generated = buildMigration();
  if (process.argv.includes('--check')) {
    const current = await Bun.file(target).text();
    if (current !== generated) {
      console.error(`${target} is out of date. Run: bun run scripts/generate-tenant-ownership-sql.ts`);
      process.exit(1);
    }
    console.log('0041 migration matches packages/db/src/tenancy-ownership.ts');
  } else {
    writeFileSync(target, generated);
    console.log(`wrote ${target}`);
  }
}

export { buildMigration };
