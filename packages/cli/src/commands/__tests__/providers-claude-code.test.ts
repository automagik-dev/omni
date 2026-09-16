import { describe, expect, test } from 'bun:test';
import { __testables as agents } from '../agents';
import { __testables } from '../providers';
import { createProvidersCommand } from '../providers';

describe('providers create --schema claude-code flag mapping (#1167)', () => {
  test('claude-code flags nest under schemaConfig', () => {
    expect(
      __testables.buildSchemaConfig({
        schema: 'claude-code',
        projectPath: '/tmp/stress-agent',
        model: 'claude-haiku-4-5-20251001',
        permissionMode: 'bypassPermissions',
        systemPrompt: 'hi',
        maxTurns: 1,
      }),
    ).toEqual({
      projectPath: '/tmp/stress-agent',
      model: 'claude-haiku-4-5-20251001',
      permissionMode: 'bypassPermissions',
      systemPrompt: 'hi',
      maxTurns: 1,
    });
  });

  test('--timeout parses as a base-10 integer (was NaN -> null via radix 60)', async () => {
    const cmd = createProvidersCommand();
    const create = cmd.commands.find((c) => c.name() === 'create');
    if (!create) throw new Error('create command missing');
    let captured: Record<string, unknown> = {};
    create.action((opts: Record<string, unknown>) => {
      captured = opts;
    });
    await create.parseAsync(
      [
        '--name',
        'x',
        '--schema',
        'claude-code',
        '--base-url',
        'local://claude-code',
        '--project-path',
        '/tmp',
        '--max-turns',
        '1',
        '--timeout',
        '120',
      ],
      { from: 'user' },
    );
    expect(captured.timeout).toBe(120);
    expect(captured.maxTurns).toBe(1);
  });
});

describe('agents create identifier error', () => {
  test('names both identifiers in one message', () => {
    const msg = agents.missingCreateIdentifiersError({ agentProvider: 'uuid' });
    expect(msg).toContain('--provider');
    expect(msg).toContain('--agent-provider');
    expect(msg).toContain('Missing --provider');
    expect(agents.missingCreateIdentifiersError({ provider: 'claude' })).toBeNull();
  });
});
