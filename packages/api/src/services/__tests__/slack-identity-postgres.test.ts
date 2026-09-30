/**
 * #1235 over REAL PostgreSQL: the Slack OAuth identity indexes (migration
 * 0079), the ON CONFLICT insert that targets them, the indexed
 * `findBySlackIdentity`, and the migration's refusal to run over duplicates.
 * A fake cannot prove Postgres infers the partial index from the conflict
 * target, so this suite does.
 *
 * Set `OMNI_G4_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you. No ambient `DATABASE_URL` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDbHandle } from '@omni/db';
import { provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { InstanceService } from '../instances';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const MIGRATION = readFileSync(
  join(import.meta.dir, '../../../../db/drizzle/0079_instances_slack_identity_unique.sql'),
  'utf-8',
);

function runSqlOn(url: string, script: string): { exitCode: number; stderr: string } {
  const file = join(tmpdir(), `omni-slack-identity-${crypto.randomUUID()}.sql`);
  writeFileSync(file, script);
  try {
    const result = Bun.spawnSync({
      cmd: [psqlBin, '-X', '--no-psqlrc', '-A', '-t', '--set', 'ON_ERROR_STOP=1', '--dbname', url, '-f', file],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return { exitCode: result.exitCode, stderr: result.stderr.toString() };
  } finally {
    rmSync(file, { force: true });
  }
}

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

const oauthRow = (name: string, slackUserId: string | null) => ({
  name,
  channel: 'slack' as const,
  slackTeamId: 'T0001',
  slackUserId,
  slackAuthMode: slackUserId ? 'user' : 'bot',
});

postgresDescribe('Slack OAuth identity uniqueness (real PostgreSQL)', () => {
  const dbName = `omni_slack_identity_${crypto.randomUUID().replaceAll('-', '')}`;
  let dbUrl: string;
  let close: () => Promise<void>;
  let service: InstanceService;

  beforeAll(() => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    dbUrl = urlFor(superUrl, dbName);
    const handle = createDbHandle({ url: dbUrl, maxConnections: 2 });
    close = handle.close;
    service = new InstanceService(handle.db, null);
  });

  afterAll(async () => {
    await close?.().catch(() => undefined);
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  test('a second user-mode insert for one identity conflicts and the lookup finds the first', async () => {
    const first = await service.createSlackOAuth(oauthRow('user-a', 'U0001'));
    expect(first).not.toBeNull();
    expect(await service.createSlackOAuth(oauthRow('user-a-dupe', 'U0001'))).toBeNull();

    expect((await service.findBySlackIdentity('T0001', 'U0001'))?.id).toBe(first?.id);
    expect(await service.findBySlackIdentity('T0001', 'U0002')).toBeUndefined();
  });

  test('two bot installs for one workspace are one identity, apart from personal rows', async () => {
    const bot = await service.createSlackOAuth(oauthRow('bot-a', null));
    expect(bot).not.toBeNull();
    expect(await service.createSlackOAuth(oauthRow('bot-a-dupe', null))).toBeNull();

    expect((await service.findBySlackIdentity('T0001', null))?.id).toBe(bot?.id);
  });

  test('manual pasted-token rows may share an identity and are never found', async () => {
    const manual = { ...oauthRow('manual-1', 'U0009'), slackConnectionMethod: 'manual' };
    await service.create(manual);
    await service.create({ ...manual, name: 'manual-2' });

    expect(await service.findBySlackIdentity('T0001', 'U0009')).toBeUndefined();
  });

  test('the migration refuses to run over duplicate OAuth rows and names them', () => {
    const setup = runSqlOn(
      dbUrl,
      `DROP INDEX "instances_slack_oauth_user_uq";
       INSERT INTO instances (id, name, channel, slack_team_id, slack_user_id, slack_connection_method) VALUES
         ('77777777-7777-4777-8777-000000000001', 'dupe-1', 'slack', 'T0DUPE', 'U0DUPE', 'oauth'),
         ('77777777-7777-4777-8777-000000000002', 'dupe-2', 'slack', 'T0DUPE', 'U0DUPE', 'oauth');`,
    );
    expect(setup.exitCode).toBe(0);

    const migrated = runSqlOn(dbUrl, MIGRATION);
    expect(migrated.exitCode).not.toBe(0);
    expect(migrated.stderr).toContain('Duplicate Slack OAuth instances');
    expect(migrated.stderr).toContain('77777777-7777-4777-8777-000000000001, 77777777-7777-4777-8777-000000000002');

    // Deleting the extra instance lets it apply.
    runSqlOn(dbUrl, `DELETE FROM instances WHERE id = '77777777-7777-4777-8777-000000000002';`);
    expect(runSqlOn(dbUrl, MIGRATION).exitCode).toBe(0);
  });
});
