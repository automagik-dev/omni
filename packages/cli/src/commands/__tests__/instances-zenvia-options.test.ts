import { describe, expect, test } from 'bun:test';
import { buildInstanceBody, createInstancesCommand } from '../instances';

function subcommand(name: string) {
  const cmd = createInstancesCommand().commands.find((c) => c.name() === name);
  if (!cmd) throw new Error(`missing ${name}`);
  return cmd;
}

function bodyOf(name: 'create' | 'update', argv: string[]) {
  const cmd = subcommand(name);
  cmd.parseOptions(argv);
  return buildInstanceBody(cmd.opts());
}

function description(name: string, flag: string): string {
  const option = subcommand(name).options.find((o) => o.long === flag);
  if (!option) throw new Error(`missing ${flag} on ${name}`);
  return option.description;
}

describe('instances create: the two webhook verify token flags', () => {
  test('writes webhookVerifyToken from either flag alone', () => {
    expect(bodyOf('create', ['--gupshup-webhook-verify-token', 'gs-token'])).toMatchObject({
      webhookVerifyToken: 'gs-token',
    });
    expect(bodyOf('create', ['--zenvia-webhook-verify-token', 'zv-token'])).toMatchObject({
      webhookVerifyToken: 'zv-token',
    });
  });

  test('rejects the two flags together, naming both', () => {
    const argv = ['--gupshup-webhook-verify-token', 'gs-token', '--zenvia-webhook-verify-token', 'zv-token'];

    expect(() => bodyOf('create', argv)).toThrow(/--gupshup-webhook-verify-token/);
    expect(() => bodyOf('create', argv)).toThrow(/--zenvia-webhook-verify-token/);
    expect(() => bodyOf('create', argv)).toThrow(/only one/);
  });

  test('neither flag leaves the field out', () => {
    expect(bodyOf('create', [])).not.toHaveProperty('webhookVerifyToken');
  });
});

describe('instances update: --zenvia-webhook-verify-token', () => {
  test('writes webhookVerifyToken and clears it with "null"', () => {
    expect(bodyOf('update', ['--zenvia-webhook-verify-token', 'zv-token'])).toMatchObject({
      webhookVerifyToken: 'zv-token',
    });
    expect(bodyOf('update', ['--zenvia-webhook-verify-token', 'null'])).toHaveProperty('webhookVerifyToken', null);
  });

  test('leaves the field out when absent', () => {
    expect(bodyOf('update', [])).not.toHaveProperty('webhookVerifyToken');
  });
});

describe('instances create/update: --zenvia-handoff-routing', () => {
  const ROUTING = { field: 'queue_field', groups: { 'queue-a': 'group-1' } };

  test.each(['create', 'update'] as const)('%s parses a JSON object', (name) => {
    expect(bodyOf(name, ['--zenvia-handoff-routing', JSON.stringify(ROUTING)])).toMatchObject({
      zenviaHandoffRouting: ROUTING,
    });
  });

  test.each(['create', 'update'] as const)('%s names the flag when the JSON is invalid', (name) => {
    for (const broken of ['{broken', "{'field':'x'}", 'queue_field', '{"field":']) {
      expect(() => bodyOf(name, ['--zenvia-handoff-routing', broken])).toThrow(
        '--zenvia-handoff-routing must be valid JSON (or "null" to clear)',
      );
    }
  });

  test('update clears the routing with "null"', () => {
    expect(bodyOf('update', ['--zenvia-handoff-routing', 'null'])).toHaveProperty('zenviaHandoffRouting', null);
  });

  test('the flag absent leaves the field out', () => {
    expect(bodyOf('update', [])).not.toHaveProperty('zenviaHandoffRouting');
  });
});

describe('instances update: help of the Zenvia flags', () => {
  test('the verify token help says "null" clears it and that it is required to connect', () => {
    const help = description('update', '--zenvia-webhook-verify-token');

    expect(help).toContain('"null"');
    expect(help).toMatch(/required to connect/);
  });

  test.each([
    '--zenvia-api-token',
    '--zenvia-sender-id',
    '--zenvia-webhook-verify-token',
    '--zenvia-sales-api-key',
    '--zenvia-handoff-group-id',
    '--zenvia-handoff-user-id',
    '--zenvia-handoff-solution',
    '--zenvia-handoff-routing',
  ])('%s help says the change needs a restart of the instance', (flag) => {
    expect(description('update', flag)).toMatch(/restart the instance/);
  });

  test('every clearable Zenvia flag still says "null" clears it', () => {
    for (const flag of [
      '--zenvia-api-token',
      '--zenvia-sender-id',
      '--zenvia-sales-api-key',
      '--zenvia-handoff-group-id',
      '--zenvia-handoff-user-id',
      '--zenvia-handoff-solution',
      '--zenvia-handoff-routing',
    ]) {
      expect(description('update', flag)).toContain('"null"');
    }
  });
});
