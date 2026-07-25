/**
 * G2 tenant-ownership contract (wish: omni-full-multitenancy, Group G2).
 *
 * Single source of truth for the ADDITIVE ownership schema. Consumed by:
 *   * migration `0041_tenant_ownership_columns.sql` (parity-tested against this file)
 *   * the online DDL runner (`online-ddl.ts`)
 *   * the trusted dual-write derivation contract (`tenancy-dual-write.ts`)
 *   * the schema-drift / writer-coverage guards (`tenancy-*.test.ts`)
 *
 * Frozen G0 inputs: `OWNERSHIP_MANIFEST.yaml` (29 `tenant`, 7 `split`, 2
 * `platform` legacy tables) and `OWNERSHIP_MATRIX.md`. G1 already delivered the
 * key/auth/audit split, so five split concepts remain for G2 — and G2 owns only
 * their ADDITIVE destination schema, never a row copy or a read/write cutover.
 *
 * Scope boundaries this file encodes (G2 is the "additive phase" of WISH
 * lines 185-190):
 *   * `tenant_id` is NULLABLE everywhere. NOT NULL waits for the G6 backfill and
 *     the zero-reconciliation gate.
 *   * Composite foreign keys are introduced `NOT VALID` — never validated here.
 *   * Every pre-existing global unique constraint is PRESERVED so a pre-G2
 *     binary keeps writing successfully (mixed-version state 1, ADR-0007).
 *   * Tenant-aware unique indexes are added as PARTIAL indexes
 *     (`WHERE tenant_id IS NOT NULL`) so they cannot reject a legacy NULL row.
 */

/** Legacy tables classified `tenant` by the frozen G0 manifest. Exactly 29. */
export const TENANT_TABLE_COUNT = 29;
/** Legacy tables classified `split` by the frozen G0 manifest. Exactly 7. */
export const SPLIT_TABLE_COUNT = 7;
/** Legacy tables classified `platform` by the frozen G0 manifest. Exactly 2. */
export const PLATFORM_TABLE_COUNT = 2;

/**
 * How a row's trusted tenant identity is established.
 *
 * `root`      — no FK-covered tenant parent AND an explicit G0 derivation rule
 *               naming authenticated context. Only such a table may accept a
 *               server-side trusted tenant id at insert.
 * `derived`   — has at least one FK-covered tenant parent. Ownership is derived
 *               from the parents' persisted tenant ids and is never caller-settable.
 * `unowned`   — has no FK-covered tenant parent and no explicit G0 root rule.
 *               Ownership stays NULL for the whole of G2; G6 backfill resolves it.
 */
export type OwnershipDerivation = 'root' | 'derived' | 'unowned';

/** Index build strategy. `high` volume tables must not take a blocking build. */
export type TableVolume = 'low' | 'high';

export interface OwningParent {
  /** Child column holding the parent id. */
  readonly column: string;
  /** Parent SQL table. Always another G2 tenant table. */
  readonly parentTable: string;
  /** True when the child column is NOT NULL, so the parent is always applicable. */
  readonly required: boolean;
}

export interface TenantOwnershipSpec {
  /** SQL table name. */
  readonly table: string;
  /** Drizzle export name in `schema.ts`. */
  readonly drizzle: string;
  readonly derivation: OwnershipDerivation;
  readonly volume: TableVolume;
  /**
   * FK-covered owning parents. G2 adds one `NOT VALID` composite foreign key
   * `(tenant_id, <column>) REFERENCES <parent> (tenant_id, id)` per entry, and
   * the dual-write derivation loads exactly these parents.
   */
  readonly parents: readonly OwningParent[];
  /**
   * True when another G2 table names this table as an owning parent, so it
   * needs the `(tenant_id, id)` unique index that backs the composite FK.
   */
  readonly compositeFkTarget: boolean;
  /** Verbatim G0 `ownership_derivation` for this table. */
  readonly g0Rule: string;
  /**
   * Why an FK column that exists in the live schema is NOT an ownership parent.
   * Present only where the exclusion is not simply "parent is not a G2 tenant table".
   */
  readonly parentExclusions?: readonly string[];
}

/**
 * Tenant-aware unique index added alongside — never replacing — an existing
 * global unique constraint. Always partial on `tenant_id IS NOT NULL` so a
 * legacy NULL-owner row can never violate it.
 */
export interface TenantUniqueIndexSpec {
  readonly name: string;
  readonly table: string;
  /** Columns after the leading `tenant_id`. */
  readonly columns: readonly string[];
  /** Extra predicate ANDed with `tenant_id IS NOT NULL`. */
  readonly extraPredicate?: string;
  /** The pre-existing global unique index this one prepares to replace (G7+). */
  readonly preservedGlobalIndex: string;
}

// ---------------------------------------------------------------------------
// The 29 tenant tables
// ---------------------------------------------------------------------------

/**
 * Ownership roots are deliberately minimal. `instances` is the ONLY table whose
 * frozen G0 rule names authenticated context as the ownership source
 * ("tenant_id assigned at instance creation from authenticated tenant context;
 * the ownership root all descendants derive from").
 *
 * Every other parentless tenant table (`persons`, `conversations`, `agents`,
 * `automations`, `webhook_sources`, `dead_letter_events`, `event_payloads`,
 * `processed_events`) has a G0 rule that names a parent which does NOT exist as
 * a column in the live schema, or names cloning/quarantine semantics that G6
 * owns. Guessing a root rule for them would let authenticated context stamp
 * ownership onto rows G0 never authorised, so they are `unowned` in G2 and their
 * ownership stays NULL until the G6 backfill resolves it. This is the
 * fail-closed reading of the G2 boundary, not an omission.
 */
export const TENANT_OWNERSHIP_SPECS: readonly TenantOwnershipSpec[] = [
  {
    table: 'instances',
    drizzle: 'instances',
    derivation: 'root',
    volume: 'low',
    parents: [],
    compositeFkTarget: true,
    g0Rule:
      'tenant_id assigned at instance creation from authenticated tenant context; the ownership root all descendants derive from',
    parentExclusions: [
      'agent_id -> agents: a configuration pointer to the default agent, not an ownership parent. G0 declares instances THE ownership root; deriving it from agents would invert the frozen ownership graph.',
      'agent_chain_to_instance_id -> instances: self-referencing routing chain, not containment.',
    ],
  },
  {
    table: 'persons',
    drizzle: 'persons',
    derivation: 'unowned',
    volume: 'high',
    parents: [],
    compositeFkTarget: true,
    g0Rule: 'tenant_id assigned per tenant; ambiguous legacy persons cloned per tenant',
  },
  {
    table: 'agents',
    drizzle: 'agents',
    derivation: 'derived',
    volume: 'low',
    parents: [{ column: 'owner_id', parentTable: 'persons', required: false }],
    compositeFkTarget: true,
    g0Rule: 'tenant_id denormalized from owning instance/creator at write',
    parentExclusions: [
      'agent_provider_id -> agent_providers: agent_providers is G0 `split`, not a tenant table; it has no tenant_id to derive from.',
      'The G0 rule names an "owning instance" that has no column on agents (the FK runs instances.agent_id -> agents). Only the real owner_id -> persons edge is used.',
    ],
  },
  {
    table: 'conversations',
    drizzle: 'conversations',
    derivation: 'unowned',
    volume: 'low',
    parents: [],
    compositeFkTarget: true,
    g0Rule: 'tenant_id denormalized from owning instance/chats',
  },
  {
    table: 'platform_identities',
    drizzle: 'platformIdentities',
    derivation: 'derived',
    volume: 'high',
    parents: [
      { column: 'person_id', parentTable: 'persons', required: false },
      { column: 'instance_id', parentTable: 'instances', required: false },
      { column: 'agent_id', parentTable: 'agents', required: false },
    ],
    compositeFkTarget: true,
    g0Rule: 'tenant_id denormalized from owning instance; composite FK to (tenant_id, person_id)',
  },
  {
    table: 'chats',
    drizzle: 'chats',
    derivation: 'derived',
    volume: 'high',
    parents: [
      { column: 'instance_id', parentTable: 'instances', required: false },
      { column: 'conversation_id', parentTable: 'conversations', required: false },
    ],
    compositeFkTarget: true,
    g0Rule: 'tenant_id denormalized from instance; composite FK to (tenant_id, instance_id)',
  },
  {
    table: 'chat_participants',
    drizzle: 'chatParticipants',
    derivation: 'derived',
    volume: 'high',
    parents: [
      { column: 'chat_id', parentTable: 'chats', required: true },
      { column: 'person_id', parentTable: 'persons', required: false },
      { column: 'platform_identity_id', parentTable: 'platform_identities', required: false },
    ],
    compositeFkTarget: false,
    g0Rule: 'tenant_id denormalized; composite FKs to chat/person/platform_identity',
  },
  {
    table: 'omni_groups',
    drizzle: 'omniGroups',
    derivation: 'derived',
    volume: 'low',
    parents: [{ column: 'instance_id', parentTable: 'instances', required: true }],
    compositeFkTarget: false,
    g0Rule: 'tenant_id denormalized from owning instance',
  },
  {
    table: 'messages',
    drizzle: 'messages',
    derivation: 'derived',
    volume: 'high',
    parents: [
      { column: 'chat_id', parentTable: 'chats', required: true },
      { column: 'sender_person_id', parentTable: 'persons', required: false },
      { column: 'sender_platform_identity_id', parentTable: 'platform_identities', required: false },
      { column: 'sender_agent_id', parentTable: 'agents', required: false },
    ],
    compositeFkTarget: true,
    g0Rule: 'tenant_id denormalized from chat/instance at persist',
  },
  {
    table: 'omni_events',
    drizzle: 'omniEvents',
    derivation: 'derived',
    volume: 'high',
    parents: [
      { column: 'instance_id', parentTable: 'instances', required: false },
      { column: 'person_id', parentTable: 'persons', required: false },
      { column: 'platform_identity_id', parentTable: 'platform_identities', required: false },
      { column: 'chat_uuid', parentTable: 'chats', required: false },
      { column: 'agent_id', parentTable: 'agents', required: false },
      { column: 'conversation_id', parentTable: 'conversations', required: false },
    ],
    compositeFkTarget: true,
    g0Rule: 'tenant_id derived from trusted instance/source record at ingest',
  },
  {
    table: 'agent_routes',
    drizzle: 'agentRoutes',
    derivation: 'derived',
    volume: 'low',
    parents: [
      { column: 'instance_id', parentTable: 'instances', required: true },
      { column: 'chat_id', parentTable: 'chats', required: false },
      { column: 'person_id', parentTable: 'persons', required: false },
      { column: 'agent_id', parentTable: 'agents', required: false },
    ],
    compositeFkTarget: true,
    g0Rule: 'tenant_id denormalized; composite FKs to (tenant_id, agent_id)/(tenant_id, instance_id)',
  },
  {
    table: 'agent_sessions',
    drizzle: 'agentSessions',
    derivation: 'derived',
    volume: 'low',
    parents: [{ column: 'instance_id', parentTable: 'instances', required: true }],
    compositeFkTarget: false,
    g0Rule: 'tenant_id denormalized from instance/agent at session open',
  },
  {
    table: 'handoff_logs',
    drizzle: 'handoffLogs',
    derivation: 'derived',
    volume: 'low',
    parents: [
      { column: 'instance_id', parentTable: 'instances', required: false },
      { column: 'chat_uuid', parentTable: 'chats', required: false },
      { column: 'agent_id', parentTable: 'agents', required: false },
    ],
    compositeFkTarget: false,
    g0Rule: 'tenant_id denormalized from chat/instance',
  },
  {
    table: 'close_contact_logs',
    drizzle: 'closeContactLogs',
    derivation: 'derived',
    volume: 'low',
    parents: [
      { column: 'instance_id', parentTable: 'instances', required: false },
      { column: 'chat_uuid', parentTable: 'chats', required: false },
      { column: 'agent_id', parentTable: 'agents', required: false },
    ],
    compositeFkTarget: false,
    g0Rule: 'tenant_id denormalized from chat/instance',
  },
  {
    table: 'access_rules',
    drizzle: 'accessRules',
    derivation: 'derived',
    volume: 'low',
    parents: [
      { column: 'instance_id', parentTable: 'instances', required: false },
      { column: 'person_id', parentTable: 'persons', required: false },
    ],
    compositeFkTarget: false,
    g0Rule: 'tenant_id required; tenant-wide vs instance-scoped is an explicit column, never NULL-instance',
  },
  {
    table: 'batch_jobs',
    drizzle: 'batchJobs',
    derivation: 'derived',
    volume: 'low',
    parents: [{ column: 'instance_id', parentTable: 'instances', required: false }],
    compositeFkTarget: true,
    g0Rule: 'tenant_id captured at enqueue from authenticated/loaded resource',
  },
  {
    table: 'sync_jobs',
    drizzle: 'syncJobs',
    derivation: 'derived',
    volume: 'low',
    parents: [{ column: 'instance_id', parentTable: 'instances', required: true }],
    compositeFkTarget: false,
    g0Rule: 'tenant_id denormalized from instance; composite FK to (tenant_id, instance_id)',
  },
  {
    table: 'media_content',
    drizzle: 'mediaContent',
    derivation: 'derived',
    volume: 'high',
    parents: [
      { column: 'event_id', parentTable: 'omni_events', required: false },
      { column: 'batch_job_id', parentTable: 'batch_jobs', required: false },
    ],
    compositeFkTarget: false,
    g0Rule: 'tenant_id denormalized from message/instance; object keys carry tenant prefix',
  },
  {
    table: 'chat_id_mappings',
    drizzle: 'chatIdMappings',
    derivation: 'derived',
    volume: 'low',
    parents: [{ column: 'instance_id', parentTable: 'instances', required: true }],
    compositeFkTarget: false,
    g0Rule: 'tenant_id denormalized from chat',
  },
  {
    table: 'dead_letter_events',
    drizzle: 'deadLetterEvents',
    derivation: 'unowned',
    volume: 'high',
    parents: [],
    compositeFkTarget: false,
    g0Rule: "tenant_id captured from the failed event's trusted context",
    parentExclusions: [
      'event_id is a varchar NATS event identifier with no foreign key to omni_events, so no composite FK can cover it. G6 resolves ownership from the source event.',
    ],
  },
  {
    table: 'event_payloads',
    drizzle: 'eventPayloads',
    derivation: 'unowned',
    volume: 'high',
    parents: [],
    compositeFkTarget: false,
    g0Rule: 'tenant_id denormalized from owning event',
    parentExclusions: [
      'event_id is a varchar NATS event identifier with no foreign key to omni_events, so no composite FK can cover it.',
    ],
  },
  {
    table: 'webhook_sources',
    drizzle: 'webhookSources',
    derivation: 'unowned',
    volume: 'low',
    parents: [],
    compositeFkTarget: false,
    g0Rule:
      'tenant_id denormalized from owning instance; server-side source record establishes tenant, not request body',
    parentExclusions: [
      'The G0 rule names an owning instance, but webhook_sources has no instance_id column in the live schema. No FK-covered parent exists, so ownership stays NULL until G6.',
    ],
  },
  {
    table: 'automations',
    drizzle: 'automations',
    derivation: 'unowned',
    volume: 'low',
    parents: [],
    compositeFkTarget: true,
    g0Rule: 'tenant_id denormalized from owning instance/creator',
    parentExclusions: [
      'The G0 rule names an owning instance/creator, but automations has no instance or creator FK column in the live schema.',
    ],
  },
  {
    table: 'automation_logs',
    drizzle: 'automationLogs',
    derivation: 'derived',
    volume: 'high',
    parents: [{ column: 'automation_id', parentTable: 'automations', required: true }],
    compositeFkTarget: false,
    g0Rule: 'tenant_id denormalized; composite FK to automation/event',
    parentExclusions: [
      'event_id is a varchar event identifier with no foreign key, so it cannot be composite-FK covered.',
    ],
  },
  {
    table: 'trigger_logs',
    drizzle: 'triggerLogs',
    derivation: 'derived',
    volume: 'high',
    parents: [
      { column: 'instance_id', parentTable: 'instances', required: true },
      { column: 'route_id', parentTable: 'agent_routes', required: false },
    ],
    compositeFkTarget: false,
    g0Rule: 'tenant_id denormalized from owning instance/agent',
    parentExclusions: [
      'provider_id -> agent_providers: agent_providers is G0 `split`, not a tenant table, so it carries no tenant_id.',
    ],
  },
  {
    table: 'agent_tasks',
    drizzle: 'agentTasks',
    derivation: 'derived',
    volume: 'low',
    parents: [
      { column: 'agent_id', parentTable: 'agents', required: true },
      { column: 'chat_id', parentTable: 'chats', required: true },
      { column: 'conversation_id', parentTable: 'conversations', required: false },
      { column: 'message_id', parentTable: 'messages', required: false },
      { column: 'parent_task_id', parentTable: 'agent_tasks', required: false },
    ],
    compositeFkTarget: true,
    g0Rule: 'tenant_id denormalized; callback tokens bind tenant + revocation epoch',
  },
  {
    table: 'turns',
    drizzle: 'turns',
    derivation: 'derived',
    volume: 'high',
    parents: [
      { column: 'instance_id', parentTable: 'instances', required: true },
      { column: 'agent_id', parentTable: 'agents', required: true },
    ],
    compositeFkTarget: false,
    g0Rule: 'tenant_id denormalized from chat/instance',
    parentExclusions: [
      'api_key_id -> api_keys: api_keys is G0 `split` and G1 replaced it with the isolated auth plane; it is not a tenant table with a tenant_id column.',
    ],
  },
  {
    table: 'chat_follow_up_state',
    drizzle: 'chatFollowUpState',
    derivation: 'derived',
    volume: 'low',
    parents: [
      { column: 'chat_id', parentTable: 'chats', required: true },
      { column: 'instance_id', parentTable: 'instances', required: true },
      { column: 'agent_id', parentTable: 'agents', required: false },
    ],
    compositeFkTarget: false,
    g0Rule: 'tenant_id denormalized from chat/instance',
  },
  {
    table: 'processed_events',
    drizzle: 'processedEvents',
    derivation: 'unowned',
    volume: 'high',
    parents: [],
    compositeFkTarget: false,
    g0Rule: 'tenant_id added to the idempotency/primary key',
    parentExclusions: [
      'G0 requires tenant in the PRIMARY KEY. Rewriting a primary key is a destructive ALTER and is out of the G2 additive boundary; G2 adds the nullable column and its index only, and the key change lands with the G6 backfill.',
    ],
  },
];

// ---------------------------------------------------------------------------
// Derived lookups
// ---------------------------------------------------------------------------

export const TENANT_TABLES: readonly string[] = TENANT_OWNERSHIP_SPECS.map((s) => s.table);

export const OWNERSHIP_ROOT_TABLES: readonly string[] = TENANT_OWNERSHIP_SPECS.filter(
  (s) => s.derivation === 'root',
).map((s) => s.table);

export function getOwnershipSpec(table: string): TenantOwnershipSpec | undefined {
  return TENANT_OWNERSHIP_SPECS.find((s) => s.table === table);
}

/** Tables that back a composite FK and therefore need `(tenant_id, id)` unique. */
export const COMPOSITE_FK_TARGETS: readonly string[] = TENANT_OWNERSHIP_SPECS.filter((s) => s.compositeFkTarget).map(
  (s) => s.table,
);

/** Deterministic constraint name for a composite same-tenant foreign key. */
export function compositeFkName(table: string, column: string): string {
  return `${table}_${column}_tenant_fk`;
}

/** Deterministic name for the `(tenant_id, id)` unique index backing composite FKs. */
export function tenantIdUniqueIndexName(table: string): string {
  return `${table}_tenant_id_uq`;
}

/** Deterministic name for the plain `tenant_id` lookup index. */
export function tenantLookupIndexName(table: string): string {
  return `${table}_tenant_idx`;
}

// ---------------------------------------------------------------------------
// Tenant-aware unique indexes (additive; every global unique is preserved)
// ---------------------------------------------------------------------------

export const TENANT_UNIQUE_INDEXES: readonly TenantUniqueIndexSpec[] = [
  {
    name: 'instances_tenant_name_uq',
    table: 'instances',
    columns: ['name'],
    preservedGlobalIndex: 'instances_name_idx',
  },
  {
    name: 'persons_tenant_phone_uq',
    table: 'persons',
    columns: ['primary_phone'],
    extraPredicate: '"primary_phone" IS NOT NULL',
    preservedGlobalIndex: 'persons_phone_idx',
  },
  {
    name: 'platform_identities_tenant_channel_user_uq',
    table: 'platform_identities',
    columns: ['channel', 'instance_id', 'platform_user_id'],
    preservedGlobalIndex: 'platform_identities_channel_user_idx',
  },
  {
    name: 'chats_tenant_instance_external_uq',
    table: 'chats',
    columns: ['instance_id', 'external_id'],
    preservedGlobalIndex: 'chats_instance_external_idx',
  },
  {
    name: 'chat_participants_tenant_chat_user_uq',
    table: 'chat_participants',
    columns: ['chat_id', 'platform_user_id'],
    preservedGlobalIndex: 'chat_participants_chat_user_idx',
  },
  {
    name: 'omni_groups_tenant_instance_external_uq',
    table: 'omni_groups',
    columns: ['instance_id', 'external_id'],
    preservedGlobalIndex: 'omni_groups_instance_external_idx',
  },
  {
    name: 'messages_tenant_chat_external_uq',
    table: 'messages',
    columns: ['chat_id', 'external_id'],
    preservedGlobalIndex: 'messages_chat_external_idx',
  },
  {
    name: 'agent_routes_tenant_chat_route_uq',
    table: 'agent_routes',
    columns: ['instance_id', 'chat_id'],
    preservedGlobalIndex: 'agent_routes_unique_chat_route',
  },
  {
    name: 'agent_routes_tenant_user_route_uq',
    table: 'agent_routes',
    columns: ['instance_id', 'person_id'],
    preservedGlobalIndex: 'agent_routes_unique_user_route',
  },
  {
    name: 'agent_sessions_tenant_instance_key_uq',
    table: 'agent_sessions',
    columns: ['instance_id', 'session_key'],
    preservedGlobalIndex: 'agent_sessions_instance_key_idx',
  },
  {
    name: 'access_rules_tenant_rule_uq',
    table: 'access_rules',
    columns: ['instance_id', 'phone_pattern', 'rule_type'],
    preservedGlobalIndex: 'access_rules_unique_idx',
  },
  {
    name: 'chat_id_mappings_tenant_instance_lid_uq',
    table: 'chat_id_mappings',
    columns: ['instance_id', 'lid_id'],
    preservedGlobalIndex: 'chat_id_mappings_instance_lid_idx',
  },
  {
    name: 'webhook_sources_tenant_name_uq',
    table: 'webhook_sources',
    columns: ['name'],
    preservedGlobalIndex: 'webhook_sources_name_idx',
  },
  {
    name: 'chat_follow_up_state_tenant_chat_instance_uq',
    table: 'chat_follow_up_state',
    columns: ['chat_id', 'instance_id'],
    preservedGlobalIndex: 'chat_follow_up_state_chat_instance_unique',
  },
];

// ---------------------------------------------------------------------------
// Split destinations — ADDITIVE SCHEMA CONTRACT ONLY
// ---------------------------------------------------------------------------

/**
 * G0 classifies 7 legacy tables `split`. G1 already delivered the key/auth/audit
 * split (`api_keys`, `api_key_audit_logs` -> `auth_credentials`,
 * `platform_api_keys`, `tenant_key_lineage`, `tenant_audit_logs`,
 * `platform_audit_logs`). The five remaining concepts get their destination
 * schemas here.
 *
 * G2 creates these tables EMPTY. It copies no legacy row, reclassifies nothing,
 * and switches no runtime read or write path — every legacy table and every read
 * stays exactly as it is at HEAD. The cutover belongs to G3/G4.
 */
export interface SplitDestinationSpec {
  /** Legacy table this concept is being separated out of. */
  readonly legacyTable: string;
  /** New tenant-plane destination, or null when the concept has no tenant half. */
  readonly tenantTable: string | null;
  /** New platform-plane destination. */
  readonly platformTable: string;
  readonly rationale: string;
}

export const SPLIT_DESTINATIONS: readonly SplitDestinationSpec[] = [
  {
    legacyTable: 'agent_providers',
    tenantTable: 'tenant_provider_config',
    platformTable: 'platform_provider_catalog',
    rationale:
      'Tenant-configured provider credentials/config separate from the immutable, non-secret built-in provider catalog.',
  },
  {
    legacyTable: 'global_settings',
    tenantTable: 'tenant_settings',
    platformTable: 'platform_settings',
    rationale: 'Canonical OWNERSHIP_MATRIX names; platform runtime values unreachable by tenant runtime.',
  },
  {
    legacyTable: 'setting_change_history',
    tenantTable: 'tenant_setting_change_history',
    platformTable: 'platform_setting_change_history',
    rationale: 'Separate append-only histories following the split of the settings they record.',
  },
  {
    legacyTable: 'plugin_storage',
    tenantTable: 'tenant_plugin_storage',
    platformTable: 'platform_plugin_storage',
    rationale: 'No mixed plugin keyspace: tenant plugin state and platform plugin state get distinct tables.',
  },
  {
    legacyTable: 'payload_storage_config',
    tenantTable: 'tenant_payload_storage_overrides',
    platformTable: 'platform_payload_storage_config',
    rationale: 'Platform backend configuration stays platform-owned; tenant overrides/quotas are a distinct table.',
  },
];

// ---------------------------------------------------------------------------
// DDL statement builders — shared by migration 0041 and the online DDL runner
// ---------------------------------------------------------------------------

export interface IndexStatement {
  readonly name: string;
  readonly table: string;
  /** Transaction-safe form, emitted into migration 0041. */
  readonly plain: string;
  /** Non-transactional form, used by the online runner. */
  readonly concurrent: string;
}

/**
 * `ALTER TABLE ... ADD COLUMN` statements. Needed by BOTH phases: nullable with
 * no default, so PostgreSQL 11+ never rewrites the table.
 */
export function addColumnStatements(): string[] {
  return TENANT_OWNERSHIP_SPECS.map((spec) => `ALTER TABLE "${spec.table}" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;`);
}

/** Every index G2 introduces, tagged with its table's volume class. */
export function allIndexStatements(): { statement: IndexStatement; volume: TableVolume }[] {
  const byTable = new Map(TENANT_OWNERSHIP_SPECS.map((s) => [s.table, s]));
  const out: { statement: IndexStatement; volume: TableVolume }[] = [];

  for (const spec of TENANT_OWNERSHIP_SPECS) {
    // Partial: a legacy NULL-owner row contributes nothing, so the lookup index
    // stays small for the whole additive phase.
    const lookupName = tenantLookupIndexName(spec.table);
    const lookupTail = `ON "${spec.table}" ("tenant_id") WHERE "tenant_id" IS NOT NULL`;
    out.push({
      volume: spec.volume,
      statement: {
        name: lookupName,
        table: spec.table,
        plain: `CREATE INDEX IF NOT EXISTS "${lookupName}" ${lookupTail};`,
        concurrent: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${lookupName}" ${lookupTail};`,
      },
    });

    if (spec.compositeFkTarget) {
      // NOT partial: a composite FK may only reference a unique index that
      // covers the referenced columns unconditionally. `id` is already the
      // primary key, so this can never reject a row that exists today.
      const uqName = tenantIdUniqueIndexName(spec.table);
      const uqTail = `ON "${spec.table}" ("tenant_id", "id")`;
      out.push({
        volume: spec.volume,
        statement: {
          name: uqName,
          table: spec.table,
          plain: `CREATE UNIQUE INDEX IF NOT EXISTS "${uqName}" ${uqTail};`,
          concurrent: `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "${uqName}" ${uqTail};`,
        },
      });
    }
  }

  for (const spec of TENANT_UNIQUE_INDEXES) {
    const columns = ['"tenant_id"', ...spec.columns.map((c) => `"${c}"`)].join(', ');
    const predicate = spec.extraPredicate
      ? `WHERE "tenant_id" IS NOT NULL AND ${spec.extraPredicate}`
      : 'WHERE "tenant_id" IS NOT NULL';
    const tail = `ON "${spec.table}" (${columns}) ${predicate}`;
    out.push({
      volume: byTable.get(spec.table)?.volume ?? 'low',
      statement: {
        name: spec.name,
        table: spec.table,
        plain: `CREATE UNIQUE INDEX IF NOT EXISTS "${spec.name}" ${tail};`,
        concurrent: `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "${spec.name}" ${tail};`,
      },
    });
  }

  return out;
}

/** Legacy tables G0 classifies `platform`; they never join the tenant plane. */
export const PLATFORM_ONLY_TABLES: readonly string[] = ['consumer_offsets', 'genie_hosts'];

/** Every new table migration 0041 creates. */
export const G2_NEW_TABLES: readonly string[] = [
  ...SPLIT_DESTINATIONS.flatMap((s) => (s.tenantTable ? [s.tenantTable, s.platformTable] : [s.platformTable])),
  'tenant_migration_ledger',
  'tenant_migration_ledger_history',
];
