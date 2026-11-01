import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOmniClient } from '@omni/sdk';
import { z } from 'zod';
import { createConnectorsCommand } from '../commands/connectors';
import * as output from '../output';

const CLI = join(import.meta.dir, '..', 'index.ts');
const configDir = mkdtempSync(join(tmpdir(), 'omni-connectors-cli-'));
const previousConfigDir = process.env.OMNI_CONFIG_DIR;
process.env.OMNI_CONFIG_DIR = configDir;
writeFileSync(
  join(configDir, 'config.json'),
  JSON.stringify({ apiUrl: 'https://omni.test.invalid', apiKey: 'mock-only' }),
);
afterAll(() => {
  if (previousConfigDir === undefined) Reflect.deleteProperty(process.env, 'OMNI_CONFIG_DIR');
  else process.env.OMNI_CONFIG_DIR = previousConfigDir;
  rmSync(configDir, { recursive: true, force: true });
});
afterEach(() => {
  // Each spy is scoped to this suite; never mock.module the shared client/output.
  for (const spy of activeSpies) spy.mockRestore();
  activeSpies.length = 0;
});
const activeSpies: Array<{ mockRestore: () => void }> = [];

function help(args: string[]): string {
  const result = Bun.spawnSync({
    cmd: [process.execPath, CLI, ...args, '--help'],
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, OMNI_CONFIG_DIR: configDir, NO_COLOR: '1' },
  });
  return `${result.stdout.toString()}\n${result.stderr.toString()}`;
}

describe('omni connectors --help', () => {
  test('lists the command group and its subcommands', () => {
    const output = help(['connectors']);
    for (const command of [
      'list',
      'get',
      'providers',
      'create',
      'update',
      'delete',
      'subscriptions',
      'test',
      'invoke',
    ]) {
      expect(output).toContain(command);
    }
  });

  test('subscriptions help lists add/pause/resume/rm', () => {
    const output = help(['connectors', 'subscriptions']);
    for (const command of ['list', 'add', 'pause', 'resume', 'rm']) expect(output).toContain(command);
  });

  test('create documents the provider/token/credential options', () => {
    const output = help(['connectors', 'create']);
    expect(output).toContain('--provider');
    expect(output).toContain('--credentials-json');
    expect(output).toContain('--hook-secret-stdin');
  });
});

const CONNECTOR_ID = '11111111-1111-4111-8111-111111111111';
const AUTOMATION_ID = '33333333-3333-4333-8333-333333333333';

function commandFixture(
  options: { secret?: string; reject?: boolean; lastEvent?: string; hasHookSecret?: boolean } = {},
) {
  const client = createOmniClient({ baseUrl: 'https://omni.test.invalid', apiKey: 'mock-only' });
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const messages: string[] = [];
  client.raw.use({
    async onRequest({ request }) {
      requests.push({
        method: request.method,
        path: new URL(request.url).pathname,
        body: request.method === 'GET' ? undefined : await request.json(),
      });
      if (options.reject)
        return Response.json(
          { error: { code: 'BAD_REQUEST', message: `provider echoed ${options.secret}` } },
          { status: 400 },
        );
      const view = {
        id: CONNECTOR_ID,
        name: 'GitLab',
        status: 'connected',
        hasHookSecret: options.hasHookSecret ?? true,
        lastUnmatchedEventType: options.lastEvent ?? null,
        inboundUrl: `https://omni.test.invalid/api/v2/connectors/hooks/${CONNECTOR_ID}`,
      };
      return Response.json({
        data: new URL(request.url).pathname.endsWith('/connectors') && request.method === 'GET' ? [view] : view,
      });
    },
  });
  activeSpies.push(
    spyOn(output, 'success').mockImplementation((message, data) => {
      messages.push(JSON.stringify({ message, data }));
    }),
  );
  activeSpies.push(
    spyOn(output, 'error').mockImplementation((message) => {
      throw new Error(message);
    }),
  );
  return {
    client,
    requests,
    messages,
    command: () =>
      createConnectorsCommand(
        () => client,
        async () => `${options.secret ?? ''}\n`,
      ),
  };
}

describe('connector ingress CLI', () => {
  for (const hasHookSecret of [true, false]) {
    test(`create/update show the hook URL only with a configured secret (${hasHookSecret})`, async () => {
      const fixture = commandFixture({ hasHookSecret });
      await fixture.command().parseAsync(['create', '--provider', 'gitlab', '--name', 'GitLab'], { from: 'user' });
      await fixture.command().parseAsync(['update', CONNECTOR_ID, '--name', 'GitLab'], { from: 'user' });
      expect(fixture.messages).toHaveLength(2);
      for (const entry of fixture.messages) {
        const { message } = z.object({ message: z.string() }).parse(JSON.parse(entry));
        if (hasHookSecret) {
          expect(message).toContain(`https://omni.test.invalid/api/v2/connectors/hooks/${CONNECTOR_ID}`);
          expect(message).toContain('CLI API URL');
          expect(message).toContain('provider needs public URL');
        } else {
          expect(message).toContain('--hook-secret-stdin');
          expect(message).not.toContain('/api/v2/connectors/hooks/');
        }
      }
    });
  }

  test('list/get/create/update remove terminal controls from the last unmatched provider name', async () => {
    const lastEvent = '\u001b[31mUnparsed provider name\u001b[0m\n\r\t\u0000\u007f';
    const fixture = commandFixture({ lastEvent });
    const views: unknown[] = [];
    activeSpies.push(
      spyOn(output, 'data').mockImplementation((value) => {
        views.push(value);
      }),
    );
    activeSpies.push(
      spyOn(output, 'list').mockImplementation((items, options) => {
        views.push(...items, ...(options?.rawData ?? []));
      }),
    );
    await fixture.command().parseAsync(['list'], { from: 'user' });
    await fixture.command().parseAsync(['get', CONNECTOR_ID], { from: 'user' });
    await fixture.command().parseAsync(['create', '--provider', 'gitlab', '--name', 'GitLab'], { from: 'user' });
    await fixture.command().parseAsync(['update', CONNECTOR_ID, '--name', 'GitLab'], { from: 'user' });
    for (const message of fixture.messages) views.push(JSON.parse(message).data);
    expect(views).toHaveLength(5);
    for (const view of views) expect(view).toMatchObject({ lastUnmatchedEventType: 'Unparsed provider name' });
  });

  test('creates a target-less glob and an exact typed target with filters', async () => {
    const fixture = commandFixture();
    for (const args of [
      ['--event', 'connector.gitlab.*', '--filters-json', '{"projectId":7}'],
      ['--event', 'connector.gitlab.merge_request.merged', '--automation', AUTOMATION_ID],
    ]) {
      await fixture
        .command()
        .parseAsync(['subscriptions', 'add', CONNECTOR_ID, '--ingress', 'connector', ...args], { from: 'user' });
    }
    expect(fixture.requests.map((r) => r.body)).toEqual([
      { ingress: 'connector', eventKey: 'connector.gitlab.*', filters: { projectId: 7 } },
      { ingress: 'connector', eventKey: 'connector.gitlab.merge_request.merged', targetAutomationId: AUTOMATION_ID },
    ]);
    expect(fixture.messages.join()).toContain(`/api/v2/connectors/hooks/${CONNECTOR_ID}`);
  });

  test('keeps the legacy subscription body and refuses missing legacy fields or connector secrets', async () => {
    const fixture = commandFixture();
    await fixture
      .command()
      .parseAsync(
        [
          'subscriptions',
          'add',
          CONNECTOR_ID,
          '--event',
          'taskCreated',
          '--automation',
          AUTOMATION_ID,
          '--secret',
          'legacy-secret',
        ],
        { from: 'user' },
      );
    expect(fixture.requests[0]?.body).toEqual({
      eventKey: 'taskCreated',
      targetAutomationId: AUTOMATION_ID,
      verificationSecret: 'legacy-secret',
    });
    await expect(
      fixture.command().parseAsync(['subscriptions', 'add', CONNECTOR_ID, '--event', 'taskCreated'], { from: 'user' }),
    ).rejects.toThrow('requires --automation and --secret');
    await expect(
      fixture
        .command()
        .parseAsync(
          [
            'subscriptions',
            'add',
            CONNECTOR_ID,
            '--ingress',
            'connector',
            '--event',
            'connector.gitlab.*',
            '--secret',
            'forbidden',
          ],
          { from: 'user' },
        ),
    ).rejects.toThrow('does not accept --secret');
    expect(fixture.requests).toHaveLength(1);
  });

  test('create and update read the hook secret from stdin without echoing it', async () => {
    const secret = 'fake-hook-secret-not-output';
    const fixture = commandFixture({ secret });
    await fixture
      .command()
      .parseAsync(['create', '--provider', 'gitlab', '--name', 'GitLab', '--hook-secret-stdin'], { from: 'user' });
    await fixture.command().parseAsync(['update', CONNECTOR_ID, '--hook-secret-stdin'], { from: 'user' });
    expect(fixture.requests.map((r) => r.body)).toEqual([
      { provider: 'gitlab', name: 'GitLab', credentials: {}, hookSecret: secret },
      { hookSecret: secret },
    ]);
    expect(fixture.messages.join()).not.toContain(secret);
    expect(fixture.messages.join()).toContain(`https://omni.test.invalid/api/v2/connectors/hooks/${CONNECTOR_ID}`);
  });

  test('empty, short and overlong stdin fail without a request or secret echo', async () => {
    for (const secret of ['', 'tiny', 'x'.repeat(513)]) {
      const fixture = commandFixture({ secret });
      await expect(
        fixture.command().parseAsync(['update', CONNECTOR_ID, '--hook-secret-stdin'], { from: 'user' }),
      ).rejects.toThrow('8 to 512');
      expect(fixture.requests).toHaveLength(0);
    }
  });

  test('a server error cannot echo the stdin hook secret', async () => {
    const secret = 'fake-hook-secret-from-stdin';
    const fixture = commandFixture({ secret, reject: true });
    try {
      await fixture.command().parseAsync(['update', CONNECTOR_ID, '--hook-secret-stdin'], { from: 'user' });
      throw new Error('expected rejection');
    } catch (error) {
      expect(String(error)).toContain('[REDACTED]');
      expect(String(error)).not.toContain(secret);
    }
  });

  test('hook secret is not accepted as a plain flag value', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, CLI, 'connectors', 'update', CONNECTOR_ID, '--hook-secret', 'plain-value'],
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, OMNI_CONFIG_DIR: configDir, NO_COLOR: '1' },
    });
    expect(result.exitCode).not.toBe(0);
    const text = `${result.stdout}\n${result.stderr}`;
    expect(text).toContain('unknown option');
    expect(text).not.toContain('plain-value');
  });

  test('the real stdin reader sends a piped secret but prints only the view and hook URL', () => {
    const secret = 'fake-stdin-pipe-secret';
    const script = `
      import { createOmniClient } from '@omni/sdk';
import { z } from 'zod';
      import { createConnectorsCommand } from ${JSON.stringify(join(import.meta.dir, '..', 'commands/connectors.ts'))};
      const client = createOmniClient({ baseUrl: 'https://omni.test.invalid', apiKey: 'mock-only' });
      client.raw.use({ async onRequest({request}) {
        const body = await request.json();
        if (body.hookSecret !== ${JSON.stringify(secret)}) throw new Error('wrong piped secret');
        return Response.json({data:{id:${JSON.stringify(CONNECTOR_ID)},name:'GitLab',status:'connected',hasHookSecret:true}});
      }});
      await createConnectorsCommand(() => client).parseAsync(['update', ${JSON.stringify(CONNECTOR_ID)}, '--hook-secret-stdin'], {from:'user'});
    `;
    const result = Bun.spawnSync({
      cmd: [process.execPath, '-e', script],
      cwd: join(import.meta.dir, '..', '..'),
      stdin: Buffer.from(`${secret}\r\n`),
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, OMNI_CONFIG_DIR: configDir, NO_COLOR: '1' },
    });
    expect(result.exitCode).toBe(0);
    const text = `${result.stdout}\n${result.stderr}`;
    expect(text).not.toContain(secret);
    expect(text).toContain('hasHookSecret');
    expect(text).toContain(`/api/v2/connectors/hooks/${CONNECTOR_ID}`);
  });
});
