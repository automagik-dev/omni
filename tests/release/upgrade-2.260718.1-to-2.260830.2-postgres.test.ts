/**
 * Release-boundary rehearsal for v2.260718.1 -> v2.260830.2.
 *
 * The suite is discovered by scripts/pg-gate.ts and therefore runs only on
 * the disposable loopback PostgreSQL cluster created by that gate. It never
 * reads DATABASE_URL or any application data.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const postgresUrl = process.env.OMNI_G2_POSTGRES_URL ?? '';
const postgresDescribe = postgresUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G2_PSQL_BIN ?? 'psql';
const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', '..', 'packages', 'db', 'drizzle');

const OLD_RELEASE_LAST_MIGRATION = '0039_instances_message_supersede_mode.sql';
const TARGET_MIGRATIONS = [
  '0040_multitenancy_control_plane.sql',
  '0041_tenant_ownership_columns.sql',
  '0042_whatsapp_cloud_channel.sql',
  '0043_hermes_channel.sql',
  '0044_instance_agent_error_message.sql',
  '0045_agent_error_messages_list.sql',
  '0046_whatsapp_flow_keys.sql',
  '0047_rename_whatsapp_cloud_to_business.sql',
  '0048_message_threads.sql',
  '0049_scheduled_messages.sql',
  '0050_slack_user_token.sql',
  '0051_message_pin_star.sql',
] as const;

// Copied from packages/core/src/types/channel.ts at commit
// 33f956ec90ccd5d5a88d177e113a796b49173d13 (v2.260718.1). The release
// cannot parse or route the replacement `whatsapp-business` identifier.
const OLD_RELEASE_CHANNEL_TYPES: readonly string[] = [
  'whatsapp-baileys',
  'whatsapp-cloud',
  'discord',
  'slack',
  'telegram',
  'a2a',
  'gupshup',
  'twilio-whatsapp',
  'internal',
];

// SHA-256 over each sorted `filename + NUL + bytes + NUL`. This pins the exact
// deployed SQL without requiring release tags to be present in a CI clone.
const OLD_RELEASE_MIGRATIONS_SHA256 = '248e59bb579dcfad6e2c160f47ae05defba406e0df04f510128d9ddbc5f310c1';
const TARGET_MIGRATIONS_SHA256 = '6837fab414b2ae5831cc1f7657fa2cb6b8f20c57bf9960f22ceb1b1bbda9c772';

const migrationFiles = readdirSync(drizzleDir)
  .filter((file) => file.endsWith('.sql'))
  .sort();
const oldReleaseMigrations = migrationFiles.filter((file) => file <= OLD_RELEASE_LAST_MIGRATION);

function migrationSql(file: string): string {
  return readFileSync(join(drizzleDir, file), 'utf-8');
}

function migrationDigest(files: readonly string[]): string {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(migrationSql(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

interface SqlResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runSqlOn(url: string, script: string): SqlResult {
  const file = join(tmpdir(), `omni-release-upgrade-${crypto.randomUUID()}.sql`);
  writeFileSync(file, script);
  try {
    const result = Bun.spawnSync({
      cmd: [psqlBin, '-X', '--no-psqlrc', '-A', '-t', '--set', 'ON_ERROR_STOP=1', '--dbname', url, '-f', file],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  } finally {
    rmSync(file, { force: true });
  }
}

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

describe('release migration artifacts', () => {
  test('the source and target boundaries stay byte-for-byte pinned', () => {
    expect(oldReleaseMigrations).toHaveLength(40);
    const targetReleaseMigrations = migrationFiles.filter(
      (file) => file > OLD_RELEASE_LAST_MIGRATION && file <= TARGET_MIGRATIONS.at(-1)!,
    );
    expect(targetReleaseMigrations).toEqual([...TARGET_MIGRATIONS]);
    expect(migrationDigest(oldReleaseMigrations)).toBe(OLD_RELEASE_MIGRATIONS_SHA256);
    expect(migrationDigest(TARGET_MIGRATIONS)).toBe(TARGET_MIGRATIONS_SHA256);
  });
});

postgresDescribe('v2.260718.1 -> v2.260830.2 release rehearsal (real PostgreSQL)', () => {
  let database = '';
  let databaseUrl = '';

  function runSql(script: string): SqlResult {
    return runSqlOn(databaseUrl, script);
  }

  function runOrThrow(script: string): void {
    const result = runSql(script);
    if (result.exitCode !== 0) throw new Error(`psql failed: ${result.stderr || result.stdout}`);
  }

  function scalar(query: string): string {
    const result = runSql(query);
    if (result.exitCode !== 0) throw new Error(`psql failed: ${result.stderr || result.stdout}`);
    return result.stdout.trim();
  }

  beforeAll(() => {
    database = `omni_release_upgrade_${crypto.randomUUID().replaceAll('-', '')}`;
    const created = runSqlOn(postgresUrl, `CREATE DATABASE "${database}";`);
    if (created.exitCode !== 0) throw new Error(`could not create disposable database: ${created.stderr}`);
    databaseUrl = urlFor(postgresUrl, database);
  });

  afterAll(() => {
    if (database) runSqlOn(postgresUrl, `DROP DATABASE IF EXISTS "${database}" WITH (FORCE);`);
  });

  test('rehearses the quiesced upgrade and proves rolling/image-only rollback unsafe', () => {
    runOrThrow(oldReleaseMigrations.map(migrationSql).join('\n'));

    // Every channel-bearing column that 0047 rewrites is populated using a
    // value accepted by the v2.260718.1 ChannelTypeSchema.
    runOrThrow(`
        INSERT INTO instances (id, name, channel)
        VALUES ('10000000-0000-4000-8000-000000000001', 'old-cloud', 'whatsapp-cloud');

        INSERT INTO platform_identities (id, instance_id, channel, platform_user_id)
        VALUES (
          '10000000-0000-4000-8000-000000000002',
          '10000000-0000-4000-8000-000000000001',
          'whatsapp-cloud',
          'old-user'
        );

        INSERT INTO chats (id, instance_id, external_id, chat_type, channel)
        VALUES (
          '10000000-0000-4000-8000-000000000003',
          '10000000-0000-4000-8000-000000000001',
          'old-chat',
          'direct',
          'whatsapp-cloud'
        );

        INSERT INTO omni_groups (id, instance_id, external_id, channel)
        VALUES (
          '10000000-0000-4000-8000-000000000004',
          '10000000-0000-4000-8000-000000000001',
          'old-group',
          'whatsapp-cloud'
        );

        INSERT INTO omni_events (id, instance_id, channel, event_type, raw_payload, metadata)
        VALUES (
          '10000000-0000-4000-8000-000000000005',
          '10000000-0000-4000-8000-000000000001',
          'whatsapp-cloud',
          'message.received',
          '{"channelType":"whatsapp-cloud"}'::jsonb,
          '{"channelType":"whatsapp-cloud"}'::jsonb
        );

        INSERT INTO sync_jobs (id, instance_id, channel, type)
        VALUES (
          '10000000-0000-4000-8000-000000000006',
          '10000000-0000-4000-8000-000000000001',
          'whatsapp-cloud',
          'profile'
        );

        INSERT INTO trigger_logs (
          id, instance_id, event_type, event_id, trigger_type, channel_type, chat_id
        ) VALUES (
          '10000000-0000-4000-8000-000000000007',
          '10000000-0000-4000-8000-000000000001',
          'message.received',
          'old-event',
          'dm',
          'whatsapp-cloud',
          'old-chat'
        );
      `);

    for (const migration of TARGET_MIGRATIONS.slice(0, 5)) runOrThrow(migrationSql(migration));

    // 0045 must preserve the short-lived 0044 scalar value before dropping
    // that column. This is not data written by v2.260718.1; it proves the
    // adjacent migration pair itself is lossless for its one valid shape.
    runOrThrow(`UPDATE instances SET agent_error_message = 'please retry' WHERE name = 'old-cloud';`);
    runOrThrow(migrationSql(TARGET_MIGRATIONS[5]));
    expect(scalar(`SELECT agent_error_messages::text FROM instances WHERE name = 'old-cloud';`)).toBe(
      '["please retry"]',
    );
    expect(
      scalar(`
          SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'instances' AND column_name = 'agent_error_message';
        `),
    ).toBe('0');

    for (const migration of TARGET_MIGRATIONS.slice(6)) runOrThrow(migrationSql(migration));

    expect(
      scalar(`
          SELECT is_nullable || '/' || coalesce(column_default, 'none')
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'instances' AND column_name = 'tenant_id';
        `),
    ).toBe('YES/none');

    const expectedTables = ['tenants', 'whatsapp_templates', 'whatsapp_flow_keys', 'scheduled_messages'];
    expect(
      scalar(`
          SELECT count(*) FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ANY(ARRAY['${expectedTables.join("','")}']);
        `),
    ).toBe(String(expectedTables.length));

    const expectedColumns = [
      ['instances', 'meta_phone_number_id'],
      ['instances', 'hermes_base_url'],
      ['instances', 'agent_error_messages'],
      ['instances', 'slack_user_token'],
      ['instances', 'slack_auth_mode'],
      ['messages', 'thread_external_id'],
      ['messages', 'thread_root_message_id'],
      ['messages', 'permalink'],
      ['messages', 'pinned_at'],
      ['messages', 'pinned_by'],
      ['messages', 'starred_at'],
    ] as const;
    const expectedColumnValues = expectedColumns.map(([table, column]) => `('${table}', '${column}')`).join(',');
    expect(
      scalar(`
          SELECT count(*)
          FROM information_schema.columns AS actual
          JOIN (VALUES ${expectedColumnValues}) AS expected(table_name, column_name)
            USING (table_name, column_name)
          WHERE actual.table_schema = 'public';
        `),
    ).toBe(String(expectedColumns.length));

    const rewritten = scalar(`
        SELECT count(*) FROM (
          SELECT channel AS value FROM instances WHERE name = 'old-cloud'
          UNION ALL SELECT channel FROM platform_identities WHERE platform_user_id = 'old-user'
          UNION ALL SELECT channel FROM chats WHERE external_id = 'old-chat'
          UNION ALL SELECT channel FROM omni_groups WHERE external_id = 'old-group'
          UNION ALL SELECT channel FROM omni_events WHERE id = '10000000-0000-4000-8000-000000000005'
          UNION ALL SELECT channel FROM sync_jobs WHERE id = '10000000-0000-4000-8000-000000000006'
          UNION ALL SELECT channel_type FROM trigger_logs WHERE id = '10000000-0000-4000-8000-000000000007'
        ) AS channel_values
        WHERE value = 'whatsapp-business';
      `);
    expect(rewritten).toBe('7');
    expect(
      scalar(`
          SELECT (raw_payload->>'channelType') || '/' || (metadata->>'channelType')
          FROM omni_events WHERE id = '10000000-0000-4000-8000-000000000005';
        `),
    ).toBe('whatsapp-cloud/whatsapp-cloud');

    // Representative old-shaped writes remain valid after the additive
    // schema changes: omitted tenant_id is accepted and stays NULL under a
    // NULL-owner root.
    runOrThrow(`
        INSERT INTO instances (id, name, channel)
        VALUES ('20000000-0000-4000-8000-000000000001', 'late-old-cloud', 'whatsapp-cloud');
        INSERT INTO chats (id, instance_id, external_id, chat_type, channel)
        VALUES (
          '20000000-0000-4000-8000-000000000002',
          '20000000-0000-4000-8000-000000000001',
          'late-old-chat',
          'direct',
          'whatsapp-cloud'
        );
        INSERT INTO messages (chat_id, external_id, source, message_type, platform_timestamp)
        VALUES (
          '20000000-0000-4000-8000-000000000002',
          'late-old-message',
          'realtime',
          'text',
          now()
        );
      `);
    expect(scalar(`SELECT coalesce(tenant_id::text, 'NULL') FROM chats WHERE external_id = 'late-old-chat';`)).toBe(
      'NULL',
    );

    // 0047 is a one-time UPDATE, not a compatibility trigger. A still-running
    // old pod therefore reintroduces the legacy id after the migration.
    expect(scalar(`SELECT channel FROM instances WHERE name = 'late-old-cloud';`)).toBe('whatsapp-cloud');
    expect(scalar(`SELECT string_agg(DISTINCT channel, ',' ORDER BY channel) FROM instances;`)).toBe(
      'whatsapp-business,whatsapp-cloud',
    );

    // Conversely, the upgraded database now contains a value outside the
    // old binary's exact runtime enum. Restoring only the old image cannot
    // restore a coherent code/data contract.
    expect(OLD_RELEASE_CHANNEL_TYPES).toContain('whatsapp-cloud');
    expect(OLD_RELEASE_CHANNEL_TYPES).not.toContain('whatsapp-business');
    expect(scalar(`SELECT count(*) FROM instances WHERE channel = 'whatsapp-business';`)).not.toBe('0');

    // The migration journal makes 0045 one-shot. Its raw SQL is not actually
    // re-entrant after the DROP because the UPDATE still references the
    // removed scalar column, so an operator must never replay the file by
    // hand as a recovery technique.
    const raw0045Replay = runSql(migrationSql(TARGET_MIGRATIONS[5]));
    expect(raw0045Replay.exitCode).not.toBe(0);
    expect(raw0045Replay.stderr).toContain('agent_error_message');

    // Away from the renamed channel, 0041's trigger fence lets an old-shaped
    // child write under a new owned root inherit its tenant safely.
    runOrThrow(`
        INSERT INTO tenants (
          id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget
        ) VALUES (
          '30000000-0000-4000-8000-000000000001',
          'release-rehearsal',
          'Release rehearsal',
          3600,
          100,
          1000
        );
        INSERT INTO instances (id, name, channel, tenant_id)
        VALUES (
          '30000000-0000-4000-8000-000000000002',
          'owned-slack',
          'slack',
          '30000000-0000-4000-8000-000000000001'
        );
        INSERT INTO chats (id, instance_id, external_id, chat_type, channel)
        VALUES (
          '30000000-0000-4000-8000-000000000003',
          '30000000-0000-4000-8000-000000000002',
          'old-shaped-owned-chat',
          'direct',
          'slack'
        );
      `);
    expect(scalar(`SELECT tenant_id FROM chats WHERE external_id = 'old-shaped-owned-chat';`)).toBe(
      '30000000-0000-4000-8000-000000000001',
    );
  }, 30_000);
});
