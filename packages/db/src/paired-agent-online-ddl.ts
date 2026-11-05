/** Journal preparation for paired-agents-slice-2 (DESIGN row 5).
 * All four builds scan the journal, including partial indexes: prepare online
 * before upgrading a large deployment, independently of the feature flag.
 * The boot guard uses planner estimates, not an exact row count.
 */
import type { IndexStatement } from './tenancy-ownership';

export const pairedAgentColumnStatements = [
  'ALTER TABLE "omni_events" ADD COLUMN IF NOT EXISTS "producing_key_id" uuid;',
  'ALTER TABLE "omni_events" ADD COLUMN IF NOT EXISTS "source_kind" varchar(32);',
  'ALTER TABLE "omni_events" ADD COLUMN IF NOT EXISTS "source_id" uuid;',
];

export const pairedAgentIndexStatements: readonly (IndexStatement & { volume: 'high' })[] = [
  {
    name: 'omni_events_instance_type_seq_idx',
    table: 'omni_events',
    plain:
      'CREATE INDEX IF NOT EXISTS "omni_events_instance_type_seq_idx" ON "omni_events" ("instance_id", "event_type", "journal_seq") WHERE "instance_id" IS NOT NULL;',
    concurrent:
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "omni_events_instance_type_seq_idx" ON "omni_events" ("instance_id", "event_type", "journal_seq") WHERE "instance_id" IS NOT NULL;',
    volume: 'high',
  },
  {
    name: 'omni_events_source_type_seq_idx',
    table: 'omni_events',
    plain:
      'CREATE INDEX IF NOT EXISTS "omni_events_source_type_seq_idx" ON "omni_events" ("source_kind", "source_id", "event_type", "journal_seq") WHERE "source_kind" IS NOT NULL;',
    concurrent:
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "omni_events_source_type_seq_idx" ON "omni_events" ("source_kind", "source_id", "event_type", "journal_seq") WHERE "source_kind" IS NOT NULL;',
    volume: 'high',
  },
  {
    name: 'omni_events_agent_type_seq_idx',
    table: 'omni_events',
    plain:
      'CREATE INDEX IF NOT EXISTS "omni_events_agent_type_seq_idx" ON "omni_events" ("agent_id", "event_type", "journal_seq") WHERE "agent_id" IS NOT NULL;',
    concurrent:
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "omni_events_agent_type_seq_idx" ON "omni_events" ("agent_id", "event_type", "journal_seq") WHERE "agent_id" IS NOT NULL;',
    volume: 'high',
  },
  {
    name: 'omni_events_producing_key_idx',
    table: 'omni_events',
    plain:
      'CREATE INDEX IF NOT EXISTS "omni_events_producing_key_idx" ON "omni_events" ("producing_key_id") WHERE "producing_key_id" IS NOT NULL;',
    concurrent:
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "omni_events_producing_key_idx" ON "omni_events" ("producing_key_id") WHERE "producing_key_id" IS NOT NULL;',
    volume: 'high',
  },
];
